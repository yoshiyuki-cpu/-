import { SupabaseClient } from '@supabase/supabase-js'

export type Cat = '廃材' | 'スクラップ' | '人工' | '燃料代' | '車両代' | '経費'
export type Ev = { project_id: number; date: string; cat: Cat; worker_id?: number }
export type ProjectRow = { id: number; name: string; status: 'active' | 'completed' }
export type WorkerRow = { id: number; name: string }

export const CAT_COLORS: Record<Cat, string> = {
  廃材: 'bg-red-400', スクラップ: 'bg-blue-400', 人工: 'bg-amber-400',
  燃料代: 'bg-emerald-400', 車両代: 'bg-purple-400', 経費: 'bg-gray-400',
}

export const DAYS_WINDOW = 90
export const RECENT_DAYS = 30
export const WEEKS = 8

export function toDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysAgo(s: string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today.getTime() - toDate(s).getTime()) / 86400000)
}

// その週の月曜日を返す
export function weekStart(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - day)
  return r
}

export async function fetchUsageEvents(supabase: SupabaseClient) {
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - DAYS_WINDOW)
  const since = sinceDate.toISOString().split('T')[0]

  const [{ data: pj }, { data: wk }, { data: waste }, { data: labor }, { data: other }, { data: scrap }] = await Promise.all([
    supabase.from('projects').select('*'),
    supabase.from('workers').select('id, name'),
    supabase.from('waste_entries').select('project_id, date, waste_types(entry_type)').gte('date', since),
    supabase.from('labor_entries').select('project_id, date, worker_id').gte('date', since),
    supabase.from('other_entries').select('project_id, date, entry_type').gte('date', since),
    supabase.from('scrap_records').select('project_id, date').gte('date', since),
  ])

  const events: Ev[] = []
  ;(waste ?? []).forEach((e: any) => {
    events.push({ project_id: e.project_id, date: e.date, cat: e.waste_types?.entry_type === 'revenue' ? 'スクラップ' : '廃材' })
  })
  ;(labor ?? []).forEach((e: any) => {
    events.push({ project_id: e.project_id, date: e.date, cat: '人工', worker_id: e.worker_id })
  })
  ;(other ?? []).forEach((e: any) => {
    const cat: Cat = e.entry_type === 'labor' ? '人工' : e.entry_type === 'fuel' ? '燃料代' : e.entry_type === 'lease' ? '車両代' : '経費'
    events.push({ project_id: e.project_id, date: e.date, cat })
  })
  ;(scrap ?? []).forEach((e: any) => {
    events.push({ project_id: e.project_id, date: e.date, cat: 'スクラップ' })
  })

  return { events, projects: (pj ?? []) as ProjectRow[], workers: (wk ?? []) as WorkerRow[] }
}

export function computeUsageMetrics(events: Ev[], projects: ProjectRow[], workers: WorkerRow[]) {
  const recent = events.filter(e => daysAgo(e.date) < RECENT_DAYS)
  const recentDays = new Set(recent.map(e => e.date)).size
  const activeProjects = projects.filter(p => p.status === 'active')

  const thisWeek = weekStart(new Date())
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(thisWeek)
    start.setDate(start.getDate() - 7 * (WEEKS - 1 - i))
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const count = events.filter(e => {
      const d = toDate(e.date)
      return d >= start && d < end
    }).length
    return { label: `${start.getMonth() + 1}/${start.getDate()}〜`, count }
  })
  const maxWeek = Math.max(1, ...weeks.map(w => w.count))

  const catCounts = (Object.keys(CAT_COLORS) as Cat[]).map(cat => ({
    cat, count: recent.filter(e => e.cat === cat).length,
  }))
  const maxCat = Math.max(1, ...catCounts.map(c => c.count))

  const lastByProject = activeProjects.map(p => {
    const dates = events.filter(e => e.project_id === p.id).map(e => e.date).sort()
    const last = dates[dates.length - 1]
    return { ...p, last, ago: last ? daysAgo(last) : null }
  }).sort((a, b) => (b.ago ?? 999) - (a.ago ?? 999))

  const laborByWorker = workers.map(w => ({
    ...w, count: recent.filter(e => e.cat === '人工' && e.worker_id === w.id).length,
  })).filter(w => w.count > 0).sort((a, b) => b.count - a.count)
  const maxWorker = Math.max(1, ...laborByWorker.map(w => w.count))

  return { recent, recentDays, activeProjects, weeks, maxWeek, catCounts, maxCat, lastByProject, laborByWorker, maxWorker }
}

export function toAiPayload(metrics: ReturnType<typeof computeUsageMetrics>) {
  return {
    today: new Date().toISOString().split('T')[0],
    summary: {
      recent30Count: metrics.recent.length,
      daysWithInput: metrics.recentDays,
      activeProjectCount: metrics.activeProjects.length,
    },
    weekly: metrics.weeks,
    byCategory: metrics.catCounts,
    projectsLastInput: metrics.lastByProject.map(p => ({ name: p.name, ago: p.ago })),
    workersLabor30d: metrics.laborByWorker.map(w => ({ name: w.name, days: w.count })),
  }
}

export function buildUsageAnalysisPrompt(stats: ReturnType<typeof toAiPayload>) {
  return `あなたは解体工事会社の経営アドバイザーです。以下は自社の工事台帳アプリの利用状況データ（JSON）です。

${JSON.stringify(stats, null, 1)}

補足:
- weekly は週別の記録件数（最後の週は今週で集計途中）
- projectsLastInput の ago は最終入力からの経過日数（null は90日以上入力なし）
- workersLabor30d は直近30日で人工（出面）記録があった日数

このデータを社長向けに日本語で分析してください。以下の4項目で、専門用語を使わず、全体で400字程度に簡潔にまとめてください。

【定着度】アプリがどれくらい使われているかの評価（1行）
【良い点】数字を挙げて2点まで
【注意点】入力が止まっている現場・記録漏れの可能性など、具体名を挙げて
【今週のアクション】社長が今週やるべきことを1〜2個、具体的に

分析文のみ返してください。前置きは不要です。`
}
