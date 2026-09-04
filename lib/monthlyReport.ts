import { SupabaseClient } from '@supabase/supabase-js'
import { fetchMonthCosts, COST_CATS, CostCat, fmtYen } from '@/lib/dailyCost'

// 月次レポート。日別の費用（lib/dailyCost.ts）と同じ集計を月でまとめる。
// 別の計算式を作らないのは、画面とレポートで数字がずれないようにするため。
export type SiteMonth = {
  projectId: number
  projectName: string
  cost: Record<CostCat, number>
  scrap: number
  total: number
  profit: number
  days: number
}

export type MonthlyReport = {
  year: number
  month: number
  sites: SiteMonth[]
  totals: { cost: Record<CostCat, number>; scrap: number; total: number; profit: number }
  daysWithRecords: number
}

export async function buildMonthlyReport(supabase: SupabaseClient, year: number, month: number): Promise<MonthlyReport> {
  const days = await fetchMonthCosts(supabase, year, month)
  const bySite = new Map<number, SiteMonth>()
  for (const day of Object.values(days)) {
    for (const s of day.sites) {
      if (!bySite.has(s.projectId)) {
        bySite.set(s.projectId, {
          projectId: s.projectId, projectName: s.projectName,
          cost: { 廃材処分: 0, 人工: 0, 燃料代: 0, 車両代: 0, 経費: 0 }, scrap: 0, total: 0, profit: 0, days: 0,
        })
      }
      const t = bySite.get(s.projectId)!
      COST_CATS.forEach(c => { t.cost[c] += s.cost[c] })
      t.scrap += s.scrap
      t.days += 1
    }
  }
  const sites = [...bySite.values()].map(s => {
    s.total = COST_CATS.reduce((sum, c) => sum + s.cost[c], 0)
    s.profit = s.scrap - s.total
    return s
  }).sort((a, b) => b.total - a.total)

  const totals = { cost: { 廃材処分: 0, 人工: 0, 燃料代: 0, 車両代: 0, 経費: 0 } as Record<CostCat, number>, scrap: 0, total: 0, profit: 0 }
  sites.forEach(s => { COST_CATS.forEach(c => { totals.cost[c] += s.cost[c] }); totals.scrap += s.scrap })
  totals.total = COST_CATS.reduce((sum, c) => sum + totals.cost[c], 0)
  totals.profit = totals.scrap - totals.total

  return { year, month, sites, totals, daysWithRecords: Object.keys(days).length }
}

// メール・Slack 用の文面。現場別は金額の大きい順に上位を出す
export function monthlyReportLines(r: MonthlyReport, appUrl: string) {
  const lines = [
    `【${r.year}年${r.month}月 月次レポート】`,
    `支出合計 ${fmtYen(r.totals.total)}／スクラップ収益 ${fmtYen(r.totals.scrap)}／差引 ${r.totals.profit >= 0 ? '+' : ''}${fmtYen(r.totals.profit)}`,
    `記録のある日 ${r.daysWithRecords}日・現場 ${r.sites.length}件`,
    '',
    '■ 区分別',
    ...COST_CATS.map(c => `　${c}　${fmtYen(r.totals.cost[c])}`),
    '',
    '■ 現場別（支出の多い順）',
    ...r.sites.slice(0, 10).map(s => `　${s.projectName}　支出 ${fmtYen(s.total)}　差引 ${s.profit >= 0 ? '+' : ''}${fmtYen(s.profit)}`),
  ]
  if (r.sites.length > 10) lines.push(`　…ほか ${r.sites.length - 10}件`)
  lines.push('', `詳細・PDF：${appUrl}/report?y=${r.year}&m=${r.month}`)
  return lines
}
