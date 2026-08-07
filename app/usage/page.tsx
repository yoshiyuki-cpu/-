'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type Cat = '廃材' | 'スクラップ' | '人工' | '燃料代' | '車両代' | '経費'
type Ev = { project_id: number; date: string; cat: Cat; worker_id?: number }
type ProjectRow = { id: number; name: string; status: 'active' | 'completed' }
type WorkerRow = { id: number; name: string }

const CAT_COLORS: Record<Cat, string> = {
  廃材: 'bg-red-400', スクラップ: 'bg-blue-400', 人工: 'bg-amber-400',
  燃料代: 'bg-emerald-400', 車両代: 'bg-purple-400', 経費: 'bg-gray-400',
}

const DAYS_WINDOW = 90
const RECENT_DAYS = 30
const WEEKS = 8

function toDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysAgo(s: string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today.getTime() - toDate(s).getTime()) / 86400000)
}

// その週の月曜日を返す
function weekStart(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - day)
  return r
}

export default function UsagePage() {
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<Ev[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - DAYS_WINDOW)
    const since = sinceDate.toISOString().split('T')[0]

    const [{ data: pj }, { data: wk }, { data: waste }, { data: labor }, { data: other }, { data: scrap }] = await Promise.all([
      supabase.from('projects').select('id, name, status'),
      supabase.from('workers').select('id, name'),
      supabase.from('waste_entries').select('project_id, date, waste_types(entry_type)').gte('date', since),
      supabase.from('labor_entries').select('project_id, date, worker_id').gte('date', since),
      supabase.from('other_entries').select('project_id, date, entry_type').gte('date', since),
      supabase.from('scrap_records').select('project_id, date').gte('date', since),
    ])

    const evs: Ev[] = []
    ;(waste ?? []).forEach((e: any) => {
      evs.push({ project_id: e.project_id, date: e.date, cat: e.waste_types?.entry_type === 'revenue' ? 'スクラップ' : '廃材' })
    })
    ;(labor ?? []).forEach((e: any) => {
      evs.push({ project_id: e.project_id, date: e.date, cat: '人工', worker_id: e.worker_id })
    })
    ;(other ?? []).forEach((e: any) => {
      const cat: Cat = e.entry_type === 'labor' ? '人工' : e.entry_type === 'fuel' ? '燃料代' : e.entry_type === 'lease' ? '車両代' : '経費'
      evs.push({ project_id: e.project_id, date: e.date, cat })
    })
    ;(scrap ?? []).forEach((e: any) => {
      evs.push({ project_id: e.project_id, date: e.date, cat: 'スクラップ' })
    })

    setProjects(pj ?? [])
    setWorkers(wk ?? [])
    setEvents(evs)
    setLoading(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const recent = events.filter(e => daysAgo(e.date) < RECENT_DAYS)

  // サマリー
  const recentDays = new Set(recent.map(e => e.date)).size
  const activeProjects = projects.filter(p => p.status === 'active')

  // 週別件数（直近8週・月曜はじまり）
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

  // 種類別（直近30日）
  const catCounts = (Object.keys(CAT_COLORS) as Cat[]).map(cat => ({
    cat, count: recent.filter(e => e.cat === cat).length,
  }))
  const maxCat = Math.max(1, ...catCounts.map(c => c.count))

  // 進行中現場ごとの最終入力
  const lastByProject = activeProjects.map(p => {
    const dates = events.filter(e => e.project_id === p.id).map(e => e.date).sort()
    const last = dates[dates.length - 1]
    return { ...p, last, ago: last ? daysAgo(last) : null }
  }).sort((a, b) => (b.ago ?? 999) - (a.ago ?? 999))

  // 作業員別 人工記録（直近30日）
  const laborByWorker = workers.map(w => ({
    ...w, count: recent.filter(e => e.cat === '人工' && e.worker_id === w.id).length,
  })).filter(w => w.count > 0).sort((a, b) => b.count - a.count)
  const maxWorker = Math.max(1, ...laborByWorker.map(w => w.count))

  async function runAiAnalysis() {
    setAiLoading(true)
    setAiError('')
    try {
      const stats = {
        today: new Date().toISOString().split('T')[0],
        summary: { recent30Count: recent.length, daysWithInput: recentDays, activeProjectCount: activeProjects.length },
        weekly: weeks,
        byCategory: catCounts,
        projectsLastInput: lastByProject.map(p => ({ name: p.name, ago: p.ago })),
        workersLabor30d: laborByWorker.map(w => ({ name: w.name, days: w.count })),
      }
      const res = await fetch('/api/analyze-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      if (!data.analysis) throw new Error('failed')
      setAiText(data.analysis)
    } catch {
      setAiError('分析に失敗しました。少し時間をおいてもう一度お試しください。')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">利用状況</h1>
        <Link href="/master" className="text-sm text-blue-600 border border-gray-200 rounded-full px-3 py-1.5 bg-white">⚙️ マスタ管理</Link>
      </div>

      {/* AI分析 */}
      <div className="mb-4">
        {!aiText && (
          <button onClick={runAiAnalysis} disabled={aiLoading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 rounded-xl font-semibold shadow-sm disabled:opacity-60 transition">
            {aiLoading ? '分析中...（10秒ほどかかります）' : '🤖 AIに利用状況を分析してもらう'}
          </button>
        )}
        {aiError && <p className="text-sm text-red-500 mt-2 text-center">{aiError}</p>}
        {aiText && (
          <section className="bg-white rounded-2xl border border-blue-100 shadow-sm p-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-gray-700">🤖 AI分析</h2>
              <button onClick={runAiAnalysis} disabled={aiLoading}
                className="text-xs text-blue-600 border border-gray-200 rounded-full px-3 py-1.5 bg-white disabled:opacity-50">
                {aiLoading ? '分析中...' : 'もう一度分析'}
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{aiText}</p>
          </section>
        )}
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{recent.length}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">直近30日の記録件数</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{recentDays}<span className="text-sm text-gray-400">/30</span></p>
          <p className="text-[11px] text-gray-500 mt-0.5">入力があった日数</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-bold text-gray-700">{activeProjects.length}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">進行中の現場</p>
        </div>
      </div>

      {/* 週別入力件数 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">週別の記録件数（直近8週）</h2>
        <div className="flex flex-col gap-1.5">
          {weeks.map(w => (
            <div key={w.label} className="flex items-center gap-2 text-sm">
              <span className="w-14 shrink-0 text-xs text-gray-500">{w.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${(w.count / maxWeek) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-xs font-medium text-gray-700">{w.count}</span>
            </div>
          ))}
        </div>
        {events.length === 0 && <p className="text-sm text-gray-400 text-center py-3">直近{DAYS_WINDOW}日の記録がありません</p>}
      </section>

      {/* 種類別 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">記録の種類別（直近30日）</h2>
        <div className="flex flex-col gap-1.5">
          {catCounts.map(c => (
            <div key={c.cat} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-xs text-gray-500">{c.cat}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div className={`${CAT_COLORS[c.cat]} h-full rounded-full transition-all`} style={{ width: `${(c.count / maxCat) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-xs font-medium text-gray-700">{c.count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 現場ごとの最終入力 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">進行中現場の最終入力</h2>
        {lastByProject.length === 0 && <p className="text-sm text-gray-400 text-center py-3">進行中の現場がありません</p>}
        <div className="flex flex-col gap-1">
          {lastByProject.map(p => (
            <Link key={p.id} href={`/projects/${p.id}`} className="flex justify-between items-center text-sm py-2 border-b border-gray-100 last:border-0">
              <span className="font-medium text-gray-800">{p.name}</span>
              {p.ago === null ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">記録なし（90日以上）</span>
              ) : p.ago >= 7 ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-medium">{p.ago}日間入力なし</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                  {p.ago === 0 ? '今日入力あり' : `${p.ago}日前に入力`}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* 作業員別 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">作業員別の人工記録（直近30日）</h2>
        {laborByWorker.length === 0 && <p className="text-sm text-gray-400 text-center py-3">直近30日の人工記録がありません</p>}
        <div className="flex flex-col gap-1.5">
          {laborByWorker.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-xs text-gray-600 truncate">{w.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div className="bg-amber-400 h-full rounded-full transition-all" style={{ width: `${(w.count / maxWorker) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-xs font-medium text-gray-700">{w.count}日</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-gray-400 text-center mb-2">
        件数は記録の登録数ベースです（記録に入力された日付で集計）
      </p>
    </div>
  )
}
