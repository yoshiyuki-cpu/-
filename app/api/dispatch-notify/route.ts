import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendReminderEmail, sendReminderPush, sendLineMessage } from '@/lib/notify'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function formatDate(date: string) {
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
  const lines = [`【${formatDate(date)} の段取り】`]

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

export async function POST(req: NextRequest) {
  const { date } = await req.json()
  if (!date) return NextResponse.json({ error: 'invalid request' }, { status: 400 })

  const { data: plan } = await supabase.from('dispatch_plans').select('id').eq('date', date).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 })

  const [{ data: groups }, { data: assignments }, { data: workers }] = await Promise.all([
    supabase.from('dispatch_groups')
      .select('id, meet_time, meet_place, note, projects(name), support_companies(name)')
      .eq('plan_id', plan.id),
    supabase.from('dispatch_assignments').select('group_id, worker_id').eq('plan_id', plan.id),
    supabase.from('workers').select('id, name').order('name'),
  ])

  const nameOf = new Map((workers ?? []).map(w => [w.id, w.name]))
  const assignedIds = new Set((assignments ?? []).map(a => a.worker_id))

  const groupRows = (groups ?? []).map((g: any) => ({
    name: g.projects?.name ?? g.support_companies?.name ?? '行き先未設定',
    meet_time: g.meet_time,
    meet_place: g.meet_place,
    note: g.note,
    workers: (assignments ?? [])
      .filter(a => a.group_id === g.id)
      .map(a => nameOf.get(a.worker_id))
      .filter((n): n is string => !!n),
  }))
  // 配員がいない行き先は段取り表に出さない（現場の一覧をそのまま流すと読みにくくなるため）
  const visibleGroups = groupRows.filter(g => g.workers.length > 0)
  const unassigned = (workers ?? []).filter(w => !assignedIds.has(w.id)).map(w => w.name)

  const lines = buildDispatchLines(date, visibleGroups, unassigned)
  const text = lines.join('\n')

  // 段取りは全体を把握する必要があるので職長全員に同じ表を送る
  const { data: foremen } = await supabase
    .from('workers').select('id, name, email, line_user_id').eq('is_foreman', true)

  const errors: string[] = []
  await Promise.all((foremen ?? []).map(async f => {
    if (f.email) {
      try { await sendReminderEmail(f.email, `【良心アプリ】${formatDate(date)}の段取り`, lines) }
      catch (e: any) { errors.push(`${f.name}メール: ${e?.message ?? 'error'}`) }
    }
    try { await sendReminderPush(supabase, f.id, `${formatDate(date)}の段取り`, '明日の段取りが決まりました', '/dispatch') }
    catch (e: any) { errors.push(`${f.name}通知: ${e?.message ?? 'error'}`) }
    if (f.line_user_id) {
      try { await sendLineMessage(f.line_user_id, text) }
      catch (e: any) { errors.push(`${f.name}LINE: ${e?.message ?? 'error'}`) }
    }
  }))

  await supabase.from('dispatch_plans').update({ notified_at: new Date().toISOString() }).eq('id', plan.id)

  return NextResponse.json({ ok: true, notified: (foremen ?? []).length, preview: text, errors })
}
