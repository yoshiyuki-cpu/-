import { SupabaseClient } from '@supabase/supabase-js'
import { sendReminderEmail, sendReminderPush, sendLineMessage } from '@/lib/notify'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function formatDispatchDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`
}

// 段取り表を組み立てる。行き先ごとに集合時間・場所と配員を並べ、
// 未配置の人が残っていれば最後に出して気づけるようにする
export function buildDispatchLines(
  date: string,
  groups: { name: string; meet_time: string | null; meet_place: string | null; note: string | null; workers: string[] }[],
  unassigned: string[],
) {
  const lines = [`【${formatDispatchDate(date)} の段取り】`]

  for (const g of groups) {
    const meet = [g.meet_time, g.meet_place].filter(Boolean).join(' ')
    lines.push('', `■ ${g.name}${meet ? `　${meet}` : ''}`)
    lines.push(`　${g.workers.length > 0 ? g.workers.join('、') : '（配員なし）'}`)
    if (g.note) lines.push(`　※${g.note}`)
  }

  if (unassigned.length > 0) {
    lines.push('', `■ 未配置`, `　${unassigned.join('、')}`)
  }
  return lines
}

export type DispatchNotifyResult =
  | { ok: false; reason: 'plan_not_found' | 'no_assignments' }
  | { ok: true; notified: number; preview: string; errors: string[] }

// 指定日の段取りを職長に送る。手動の「通知する」ボタンと18:30の自動送信の両方から使う
export async function notifyDispatch(supabase: SupabaseClient, date: string): Promise<DispatchNotifyResult> {
  const { data: plan } = await supabase.from('dispatch_plans').select('id').eq('date', date).maybeSingle()
  if (!plan) return { ok: false, reason: 'plan_not_found' }

  const [{ data: groups }, { data: assignments }, { data: workers }] = await Promise.all([
    supabase.from('dispatch_groups')
      .select('id, meet_time, meet_place, note, projects(name), support_companies(name)')
      .eq('plan_id', plan.id),
    supabase.from('dispatch_assignments').select('group_id, worker_id').eq('plan_id', plan.id),
    supabase.from('workers').select('id, name, in_dispatch').order('name'),
  ])

  // 誰も配置していない日に空の段取り表を送らない（自動送信では特に重要）
  if (!assignments || assignments.length === 0) return { ok: false, reason: 'no_assignments' }

  const nameOf = new Map((workers ?? []).map(w => [w.id, w.name]))
  const assignedIds = new Set(assignments.map(a => a.worker_id))

  const groupRows = (groups ?? []).map((g: any) => ({
    name: g.projects?.name ?? g.support_companies?.name ?? '行き先未設定',
    meet_time: g.meet_time,
    meet_place: g.meet_place,
    note: g.note,
    workers: assignments
      .filter(a => a.group_id === g.id)
      .map(a => nameOf.get(a.worker_id))
      .filter((n): n is string => !!n),
  }))
  // 配員がいない行き先は段取り表に出さない（現場の一覧をそのまま流すと読みにくくなるため）
  const visibleGroups = groupRows.filter(g => g.workers.length > 0)
  // 事務員など段取りに出さない人は未配置に数えない
  const unassigned = (workers ?? [])
    .filter(w => w.in_dispatch && !assignedIds.has(w.id))
    .map(w => w.name)

  const lines = buildDispatchLines(date, visibleGroups, unassigned)
  const text = lines.join('\n')

  // 段取りは全体を把握する必要があるので職長全員に同じ表を送る
  const { data: foremen } = await supabase
    .from('workers').select('id, name, email, line_user_id').eq('is_foreman', true)

  const errors: string[] = []
  await Promise.all((foremen ?? []).map(async f => {
    if (f.email) {
      try { await sendReminderEmail(f.email, `【良心アプリ】${formatDispatchDate(date)}の段取り`, lines) }
      catch (e: any) { errors.push(`${f.name}メール: ${e?.message ?? 'error'}`) }
    }
    try { await sendReminderPush(supabase, f.id, `${formatDispatchDate(date)}の段取り`, '明日の段取りが決まりました', '/dispatch') }
    catch (e: any) { errors.push(`${f.name}通知: ${e?.message ?? 'error'}`) }
    if (f.line_user_id) {
      try { await sendLineMessage(f.line_user_id, text) }
      catch (e: any) { errors.push(`${f.name}LINE: ${e?.message ?? 'error'}`) }
    }
  }))

  await supabase.from('dispatch_plans').update({ notified_at: new Date().toISOString() }).eq('id', plan.id)

  return { ok: true, notified: (foremen ?? []).length, preview: text, errors }
}
