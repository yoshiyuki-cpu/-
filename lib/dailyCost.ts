import { SupabaseClient } from '@supabase/supabase-js'

// 現場詳細の集計カードと同じ区分・同じ足し方にする。
// ここがずれると「現場の合計」と「日ごとの合計」が合わなくなり、どちらが正しいか分からなくなる。
export type CostCat = '廃材処分' | '人工' | '燃料代' | '車両代' | '経費'
export const COST_CATS: CostCat[] = ['廃材処分', '人工', '燃料代', '車両代', '経費']

export const CAT_STYLES: Record<CostCat, string> = {
  廃材処分: 'text-red-600',
  人工: 'text-amber-600',
  燃料代: 'text-emerald-600',
  車両代: 'text-purple-600',
  経費: 'text-gray-600',
}

export type SiteDayCost = {
  projectId: number
  projectName: string
  cost: Record<CostCat, number>
  scrap: number
  total: number
}

export type DayCost = {
  date: string
  sites: SiteDayCost[]
  total: number
  scrap: number
}

function emptyCost(): Record<CostCat, number> {
  return { 廃材処分: 0, 人工: 0, 燃料代: 0, 車両代: 0, 経費: 0 }
}

export function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, '0')
  // その月の末日。日付の足し算だけなのでタイムゾーンの影響を受けない
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`, lastDay }
}

type Row = { project_id: number | null; date: string; amount: number | string }
type WasteRow = Row & { waste_types: { entry_type: string } | { entry_type: string }[] | null }
type OtherRow = Row & { entry_type: string }

// PostgRESTは繋いだ表を1件でも配列で返すことがあるので、どちらでも読めるようにする
function entryTypeOf(w: WasteRow['waste_types']) {
  if (!w) return null
  return Array.isArray(w) ? w[0]?.entry_type ?? null : w.entry_type
}

export async function fetchMonthCosts(supabase: SupabaseClient, year: number, month: number) {
  const { from, to } = monthRange(year, month)

  const [{ data: pj }, { data: waste }, { data: labor }, { data: other }, { data: scrap }] = await Promise.all([
    supabase.from('projects').select('id, name'),
    supabase.from('waste_entries').select('project_id, date, amount, waste_types(entry_type)').gte('date', from).lte('date', to),
    supabase.from('labor_entries').select('project_id, date, amount').gte('date', from).lte('date', to),
    supabase.from('other_entries').select('project_id, date, amount, entry_type').gte('date', from).lte('date', to),
    supabase.from('scrap_records').select('project_id, date, amount').gte('date', from).lte('date', to),
  ])

  const names = new Map<number, string>()
  ;(pj ?? []).forEach((p: { id: number; name: string }) => names.set(p.id, p.name))

  const days = new Map<string, Map<number, SiteDayCost>>()
  function bucket(date: string, projectId: number) {
    if (!days.has(date)) days.set(date, new Map())
    const sites = days.get(date)!
    if (!sites.has(projectId)) {
      sites.set(projectId, {
        projectId,
        projectName: names.get(projectId) ?? '（削除された現場）',
        cost: emptyCost(),
        scrap: 0,
        total: 0,
      })
    }
    return sites.get(projectId)!
  }

  const add = (date: string, projectId: number | null, cat: CostCat | 'スクラップ', amount: number) => {
    if (!date || projectId == null) return
    const b = bucket(date, projectId)
    if (cat === 'スクラップ') b.scrap += amount
    else b.cost[cat] += amount
  }

  ;((waste ?? []) as unknown as WasteRow[]).forEach(e => {
    // 廃材種類ごとに「費用」か「売上」かが決まっている（鉄クズなどは売上）
    const isRevenue = entryTypeOf(e.waste_types) === 'revenue'
    add(e.date, e.project_id, isRevenue ? 'スクラップ' : '廃材処分', Number(e.amount))
  })
  ;((labor ?? []) as unknown as Row[]).forEach(e => add(e.date, e.project_id, '人工', Number(e.amount)))
  ;((other ?? []) as unknown as OtherRow[]).forEach(e => {
    const cat: CostCat = e.entry_type === 'labor' ? '人工'
      : e.entry_type === 'fuel' ? '燃料代'
      : e.entry_type === 'lease' ? '車両代' : '経費'
    add(e.date, e.project_id, cat, Number(e.amount))
  })
  ;((scrap ?? []) as unknown as Row[]).forEach(e => add(e.date, e.project_id, 'スクラップ', Number(e.amount)))

  const result: Record<string, DayCost> = {}
  for (const [date, sites] of days) {
    const list = [...sites.values()]
    list.forEach(s => { s.total = COST_CATS.reduce((sum, c) => sum + s.cost[c], 0) })
    // 金額の大きい現場から並べる。その日どこに一番かかったかを先に見せる
    list.sort((a, b) => b.total - a.total || a.projectName.localeCompare(b.projectName, 'ja'))
    result[date] = {
      date,
      sites: list,
      total: list.reduce((s, x) => s + x.total, 0),
      scrap: list.reduce((s, x) => s + x.scrap, 0),
    }
  }
  return result
}

// カレンダーのマスは幅が狭いので万単位に丸める。1万円未満はそのまま出す
export function fmtCompact(n: number) {
  if (n === 0) return ''
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return n.toLocaleString('ja-JP')
}

export function fmtYen(n: number) {
  return n.toLocaleString('ja-JP') + '円'
}
