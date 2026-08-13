'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import {
  CAT_COLORS, DAYS_WINDOW, fetchUsageEvents, computeUsageMetrics, toAiPayload,
  type Ev, type ProjectRow, type WorkerRow,
} from '@/lib/usageStats'

function formatTimestamp(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function UsagePage() {
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<Ev[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [aiText, setAiText] = useState('')
  const [aiAt, setAiAt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [{ events: evs, projects: pj, workers: wk }, { data: latest }] = await Promise.all([
      fetchUsageEvents(supabase),
      supabase.from('usage_analyses').select('analysis, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    setProjects(pj)
    setWorkers(wk)
    setEvents(evs)
    if (latest) {
      setAiText(latest.analysis)
      setAiAt(latest.created_at)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const { recent, recentDays, activeProjects, weeks, maxWeek, catCounts, maxCat, lastByProject, laborByWorker, maxWorker } =
    computeUsageMetrics(events, projects, workers)

  async function runAiAnalysis() {
    setAiLoading(true)
    setAiError('')
    try {
      const stats = toAiPayload(computeUsageMetrics(events, projects, workers))
      const res = await fetch('/api/analyze-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      if (!data.analysis) throw new Error('failed')
      setAiText(data.analysis)
      setAiAt(new Date().toISOString())
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
            {aiAt && <p className="text-xs text-gray-400 mt-2 text-right">最終分析: {formatTimestamp(aiAt)}（毎朝自動でも更新されます）</p>}
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
