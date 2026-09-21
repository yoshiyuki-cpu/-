import type { SupabaseClient } from '@supabase/supabase-js'

// LINE からの報告を台帳に入れる部品。サーバー（Webhook）とアプリの「LINE報告」画面の両方から使う。
// ここには Anthropic SDK を入れない（画面側でも import するため）。読み取り（AI）は API ルート側。

// 人工の単価は entry 画面と同じ（税抜15,000円×1.1、半日はその半分）
const LABOR_UNIT_PRICE = Math.round(15000 * 1.1)
const LABOR_UNIT_PRICE_HALF = Math.round(LABOR_UNIT_PRICE / 2)

export type ParsedLabor = { worker_id: number; day_type: 'full' | 'half' }
export type ParsedWaste = { waste_type_id: number; quantity: number; amount: number | null }
export type ParsedOther = { entry_type: 'fuel' | 'lease' | 'expense'; amount: number; note: string | null; vehicle_id: number | null }
export type Parsed = {
  is_report: boolean
  project_id: number | null
  date: string
  labor: ParsedLabor[]
  waste: ParsedWaste[]
  others: ParsedOther[]
  unmatched: string[]
}

export type LineReport = {
  id: number
  received_at: string
  line_event_id: string | null
  line_group_id: string | null
  line_user_id: string | null
  worker_id: number | null
  text: string | null
  parsed: Parsed | null
  status: 'pending' | 'registered' | 'cancelled' | 'rejected' | 'ignored'
  project_id: number | null
  registered_at: string | null
  note: string | null
}

// 読み取り結果を人が読める行にするための名前一覧
export type NameCtx = {
  projects: { id: number; name: string }[]
  workers: { id: number; name: string }[]
  wasteTypes: { id: number; name: string; unit: string; unit_price: number }[]
  vehicles: { id: number; name: string }[]
}

export async function loadNameCtx(supabase: SupabaseClient): Promise<NameCtx> {
  const [{ data: pj }, { data: wk }, { data: wt }, { data: vh }] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    supabase.from('workers').select('id, name, in_dispatch').order('name'),
    supabase.from('waste_types').select('id, name, unit, unit_price').order('name'),
    supabase.from('vehicles').select('id, name').order('name'),
  ])
  return {
    // 進行中の現場だけ。ごみ箱・完了は候補に出さない（deleted_at は列が無い環境もあるので JS 側で見る）
    projects: (pj ?? []).filter((p: { status?: string; deleted_at?: string | null }) => p.status === 'active' && !p.deleted_at)
      .map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })),
    workers: (wk ?? []).filter((w: { in_dispatch?: boolean }) => w.in_dispatch !== false)
      .map((w: { id: number; name: string }) => ({ id: w.id, name: w.name })),
    wasteTypes: (wt ?? []) as NameCtx['wasteTypes'],
    vehicles: (vh ?? []) as NameCtx['vehicles'],
  }
}

export function fmtDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${m}/${day}`
}

// AI が返した JSON を、こちらが知っている ID だけに絞って安全な形にする
export function sanitizeParsed(raw: unknown, ctx: NameCtx, today: string): Parsed {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pid = new Set(ctx.projects.map(p => p.id))
  const wid = new Set(ctx.workers.map(w => w.id))
  const tid = new Set(ctx.wasteTypes.map(t => t.id))
  const vid = new Set(ctx.vehicles.map(v => v.id))
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const project_id = typeof r.project_id === 'number' && pid.has(r.project_id) ? r.project_id : null
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today
  const labor: ParsedLabor[] = []
  for (const e of arr(r.labor) as Record<string, unknown>[]) {
    const id = num(e?.worker_id)
    if (id != null && wid.has(id) && !labor.some(l => l.worker_id === id)) {
      labor.push({ worker_id: id, day_type: e.day_type === 'half' ? 'half' : 'full' })
    }
  }
  const waste: ParsedWaste[] = []
  for (const e of arr(r.waste) as Record<string, unknown>[]) {
    const id = num(e?.waste_type_id); const q = num(e?.quantity)
    if (id != null && tid.has(id) && q != null && q > 0) waste.push({ waste_type_id: id, quantity: q, amount: num(e.amount) })
  }
  const others: ParsedOther[] = []
  for (const e of arr(r.others) as Record<string, unknown>[]) {
    const amount = num(e?.amount)
    const t = e?.entry_type
    if (amount != null && amount > 0 && (t === 'fuel' || t === 'lease' || t === 'expense')) {
      const v = num(e.vehicle_id)
      others.push({ entry_type: t, amount, note: typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null, vehicle_id: v != null && vid.has(v) ? v : null })
    }
  }
  const unmatched = arr(r.unmatched).filter((u): u is string => typeof u === 'string' && u.trim() !== '')
  const is_report = r.is_report !== false && (labor.length + waste.length + others.length + unmatched.length > 0 || project_id != null)
  return { is_report, project_id, date, labor, waste, others, unmatched }
}

// 読み取り結果を日本語の行にする（LINE の返信と、アプリの一覧で同じ文を使う）
export function summaryLines(p: Parsed, ctx: NameCtx): string[] {
  const name = (list: { id: number; name: string }[], id: number) => list.find(x => x.id === id)?.name ?? `#${id}`
  const lines: string[] = []
  if (p.labor.length) {
    lines.push('人工：' + p.labor.map(l => `${name(ctx.workers, l.worker_id)}${l.day_type === 'half' ? '（半日）' : ''}`).join('、'))
  }
  for (const w of p.waste) {
    const t = ctx.wasteTypes.find(x => x.id === w.waste_type_id)
    const amount = w.amount ?? (t ? Math.round(t.unit_price * w.quantity) : 0)
    lines.push(`廃材：${t?.name ?? `#${w.waste_type_id}`} ${w.quantity}${t?.unit ?? ''} ${amount.toLocaleString()}円`)
  }
  for (const o of p.others) {
    const label = o.entry_type === 'fuel' ? '燃料代' : o.entry_type === 'lease' ? '車両代' : '経費'
    const v = o.vehicle_id != null ? name(ctx.vehicles, o.vehicle_id) : ''
    lines.push(`${label}：${o.amount.toLocaleString()}円${v ? ` ${v}` : ''}${o.note ? ` ${o.note}` : ''}`)
  }
  return lines
}

export function hasEntries(p: Parsed) {
  return p.labor.length + p.waste.length + p.others.length > 0
}

// 台帳に入れる。同じ日・同じ現場に既にいる人の人工は重ねない。
// 戻り値は入れた件数と、飛ばした人。列が無い環境（SQL 未実行）では 'no-column' を投げる
export async function registerParsed(
  supabase: SupabaseClient, reportId: number, p: Parsed, projectId: number, ctx: NameCtx,
): Promise<{ inserted: number; skippedLabor: string[] }> {
  let inserted = 0
  const skippedLabor: string[] = []

  if (p.labor.length) {
    const { data: existing } = await supabase.from('labor_entries')
      .select('worker_id').eq('project_id', projectId).eq('date', p.date)
    const already = new Set((existing ?? []).map((e: { worker_id: number }) => e.worker_id))
    const rows = p.labor.filter(l => {
      if (already.has(l.worker_id)) { skippedLabor.push(ctx.workers.find(w => w.id === l.worker_id)?.name ?? ''); return false }
      return true
    }).map(l => ({
      project_id: projectId, worker_id: l.worker_id, date: p.date, day_type: l.day_type,
      amount: l.day_type === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE, line_report_id: reportId,
    }))
    if (rows.length) {
      const { error } = await supabase.from('labor_entries').insert(rows)
      if (error) throw new Error(error.message.includes('line_report_id') ? 'no-column' : error.message)
      inserted += rows.length
    }
  }

  if (p.waste.length) {
    const rows = p.waste.map(w => {
      const t = ctx.wasteTypes.find(x => x.id === w.waste_type_id)
      return {
        project_id: projectId, waste_type_id: w.waste_type_id, date: p.date, quantity: w.quantity,
        amount: w.amount ?? (t ? Math.round(t.unit_price * w.quantity) : 0), line_report_id: reportId,
      }
    })
    const { error } = await supabase.from('waste_entries').insert(rows)
    if (error) throw new Error(error.message.includes('line_report_id') ? 'no-column' : error.message)
    inserted += rows.length
  }

  if (p.others.length) {
    const rows = p.others.map(o => ({
      project_id: projectId, entry_type: o.entry_type, date: p.date, quantity: 1, unit_price: o.amount,
      amount: o.amount, note: o.note, fuel_type: null, vehicle_id: o.vehicle_id, line_report_id: reportId,
    }))
    const { error } = await supabase.from('other_entries').insert(rows)
    if (error) throw new Error(error.message.includes('line_report_id') ? 'no-column' : error.message)
    inserted += rows.length
  }

  await supabase.from('line_reports').update({
    status: 'registered', project_id: projectId, registered_at: new Date().toISOString(),
  }).eq('id', reportId)
  return { inserted, skippedLabor }
}

// 取消：この報告から入れた台帳の行を消す
export async function cancelReport(supabase: SupabaseClient, reportId: number): Promise<number> {
  let removed = 0
  for (const table of ['labor_entries', 'waste_entries', 'other_entries']) {
    const { data } = await supabase.from(table).delete().eq('line_report_id', reportId).select('id')
    removed += (data ?? []).length
  }
  await supabase.from('line_reports').update({ status: 'cancelled' }).eq('id', reportId)
  return removed
}
