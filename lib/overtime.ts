import type { SupabaseClient } from '@supabase/supabase-js'

// 残業代（labor_overtime）を現場の原価（人工費）に振り分ける。2026-10 社長の指示。
//
// 残業代は作業員ごと・日ごとに1つ。その日にその人が入っていた現場へ、人工の割合で分ける
// （全日=1、半日=0.5。2現場に半日ずつなら半分ずつ、1現場なら全額）。
// その日に人工の記録が無い残業代は、どの現場か分からないので原価には入れない（出面には出る）。
// 現場一覧・現場詳細・日別の費用・月次レポートの4か所が同じ振り分けを使う。

export type OvertimeRow = { worker_id: number | null; date: string; amount: number | string }
export type LaborLite = { project_id: number | null; worker_id: number | null; date: string; day_type?: string | null }
export type OvertimeShare = { project_id: number; worker_id: number; date: string; amount: number }

export function allocateOvertime(overtime: OvertimeRow[], labor: LaborLite[]): OvertimeShare[] {
  const byKey = new Map<string, { project_id: number; units: number }[]>()
  for (const l of labor) {
    if (l.project_id == null || l.worker_id == null) continue
    const k = `${l.worker_id}:${l.date}`
    const list = byKey.get(k) ?? []
    list.push({ project_id: l.project_id, units: l.day_type === 'half' ? 0.5 : 1 })
    byKey.set(k, list)
  }
  const out: OvertimeShare[] = []
  for (const o of overtime) {
    const amount = Number(o.amount) || 0
    if (!amount || o.worker_id == null) continue
    const list = byKey.get(`${o.worker_id}:${o.date}`)
    if (!list?.length) continue
    const units = list.reduce((s, x) => s + x.units, 0)
    // 円未満の端数は最後の現場に寄せて、合計が残業代と必ず一致するようにする
    let rest = amount
    list.forEach((x, i) => {
      const share = i === list.length - 1 ? rest : Math.round((amount * x.units) / units)
      rest -= share
      out.push({ project_id: x.project_id, worker_id: o.worker_id as number, date: o.date, amount: share })
    })
  }
  return out
}

// 期間の残業代を読む。表が無い環境（SQL 未実行）では空（原価は今までどおり）
export async function fetchOvertime(supabase: SupabaseClient, from?: string, to?: string): Promise<OvertimeRow[]> {
  const PAGE = 1000
  const rows: OvertimeRow[] = []
  for (let i = 0; ; i += PAGE) {
    let q = supabase.from('labor_overtime').select('worker_id, date, amount')
    if (from) q = q.gte('date', from)
    if (to) q = q.lte('date', to)
    const { data, error } = await q.order('id').range(i, i + PAGE - 1)
    if (error) return []
    const chunk = (data ?? []) as OvertimeRow[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}
