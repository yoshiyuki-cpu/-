'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'
import { LineReport, NameCtx, loadNameCtx, summaryLines, hasEntries, registerParsed, cancelReport, fmtDate } from '@/lib/lineReport'

type Tab = 'pending' | 'registered' | 'all'

const STATUS_LABEL: Record<LineReport['status'], string> = {
  pending: '確認待ち', registered: '登録済み', cancelled: '取消', rejected: '却下', ignored: '報告ではない',
}

function jstTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export default function LineReportsPage() {
  const [reports, setReports] = useState<LineReport[]>([])
  const [ctx, setCtx] = useState<NameCtx | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [projectPick, setProjectPick] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString()
    const [{ data, error }, c] = await Promise.all([
      supabase.from('line_reports').select('*').gte('received_at', since).order('received_at', { ascending: false }).limit(300),
      loadNameCtx(supabase),
    ])
    if (error) setNeedsSetup(true)
    setReports((data ?? []) as LineReport[])
    setCtx(c)
    setLoading(false)
  }

  async function register(r: LineReport) {
    if (!ctx || !r.parsed) return
    const projectId = Number(projectPick[r.id] ?? r.parsed.project_id ?? 0)
    if (!projectId) { setMessage('どの現場か選んでください。'); return }
    setBusy(r.id); setMessage('')
    try {
      const { inserted, skippedLabor } = await registerParsed(supabase, r.id, r.parsed, projectId, ctx)
      const pname = ctx.projects.find(p => p.id === projectId)?.name ?? ''
      logAction(supabase, 'create', 'line_reports', r.id, `LINE報告を ${pname} の台帳に入れた（${inserted}件）`)
      setMessage(`${pname} に ${inserted}件 入れました。${skippedLabor.length ? `${skippedLabor.join('、')} は同じ日に登録済みのため重ねていません。` : ''}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setMessage(msg.startsWith('gate:')
        ? `この日の${msg.slice(5)}がまだなので、人工・処分代は入れられません。先に現場の KY活動・議事録を登録してください。`
        : msg === 'no-column'
        ? 'LINE報告の準備がまだです。Supabaseで supabase-schema-line-reports.sql を実行してください。'
        : '台帳に入れられませんでした。もう一度お試しください。')
    }
    setBusy(null)
    await load()
  }

  async function cancel(r: LineReport) {
    if (!confirm('この報告で台帳に入れた行を消しますか？')) return
    setBusy(r.id); setMessage('')
    const removed = await cancelReport(supabase, r.id)
    logAction(supabase, 'delete', 'line_reports', r.id, `LINE報告を取り消した（${removed}件を台帳から消した）`)
    setMessage(`${removed}件を台帳から消しました。`)
    setBusy(null)
    await load()
  }

  async function reject(r: LineReport) {
    setBusy(r.id); setMessage('')
    await supabase.from('line_reports').update({ status: 'rejected' }).eq('id', r.id)
    setBusy(null)
    await load()
  }

  const shown = reports.filter(r =>
    tab === 'pending' ? r.status === 'pending' : tab === 'registered' ? r.status === 'registered' : r.status !== 'ignored')
  const pendingCount = reports.filter(r => r.status === 'pending').length
  const reporter = (r: LineReport) => ctx?.workers.find(w => w.id === r.worker_id)?.name ?? (r.worker_id ? `#${r.worker_id}` : '未連携')

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">LINE報告</h1>
      <p className="text-xs text-gray-500 mb-4">
        グループLINEに書かれた報告（人工・廃材・経費）を、AIが読み取って台帳に入れています。
        現場が分からなかったものはここで振り分けてください。間違いは「取消」で台帳から消せます。
      </p>

      {needsSetup && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
          <p className="text-sm text-amber-800">LINE報告の準備がまだです。</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Supabaseで <span className="font-mono">supabase-schema-line-reports.sql</span> を実行すると使えるようになります。
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {([['pending', `確認待ち${pendingCount ? ` ${pendingCount}` : ''}`], ['registered', '登録済み'], ['all', 'すべて']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {message && <div className="bg-green-100 text-green-800 rounded-lg px-3 py-2 text-sm mb-3">{message}</div>}

      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && shown.length === 0 && !needsSetup && (
        <p className="text-gray-400 text-center py-10 text-sm">
          {tab === 'pending' ? '確認待ちの報告はありません。' : 'まだ報告がありません。グループLINEに「福田 今日 西谷と山田 1日ずつ、木屑 3t」のように書くと届きます。'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {ctx && shown.map(r => {
          const p = r.parsed
          const lines = p ? summaryLines(p, ctx) : []
          const projectId = p?.project_id ?? r.project_id
          const pname = projectId != null ? ctx.projects.find(x => x.id === projectId)?.name : null
          const pick = projectPick[r.id] ?? (projectId != null ? String(projectId) : '')
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex justify-between items-baseline gap-2 mb-1">
                <span className="text-xs text-gray-500">{jstTime(r.received_at)}　{reporter(r)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'registered' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap border-l-2 border-gray-200 pl-2 mb-2">{r.text}</p>
              {p && (
                <div className="text-sm text-gray-700 mb-2">
                  <p className="font-medium">{pname ?? <span className="text-amber-700">現場：不明</span>}　{fmtDate(p.date)}</p>
                  {lines.map((l, i) => <p key={i}>・{l}</p>)}
                  {p.unmatched.length > 0 && <p className="text-xs text-amber-700 mt-1">読み取れなかった部分：{p.unmatched.join('、')}</p>}
                </div>
              )}

              {r.status === 'pending' && p && (
                <div className="flex flex-col gap-2 mt-2">
                  <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base bg-white"
                    value={pick} onChange={e => setProjectPick(m => ({ ...m, [r.id]: e.target.value }))}>
                    <option value="">現場を選ぶ</option>
                    {ctx.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => reject(r)} disabled={busy === r.id}
                      className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 disabled:opacity-40">却下</button>
                    {hasEntries(p) ? (
                      <button onClick={() => register(r)} disabled={busy === r.id || !pick}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">
                        {busy === r.id ? '登録中...' : '台帳に入れる'}
                      </button>
                    ) : (
                      <Link href={pick ? `/projects/${pick}/entry` : '#'}
                        className={`flex-1 py-2 text-center rounded-lg text-sm font-medium ${pick ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400 pointer-events-none'}`}>
                        手で入力する
                      </Link>
                    )}
                  </div>
                </div>
              )}
              {r.status === 'registered' && (
                <div className="flex gap-2 mt-2">
                  {projectId != null && (
                    <Link href={`/projects/${projectId}`} className="flex-1 py-2 text-center border border-gray-200 rounded-lg text-sm text-blue-600">現場を見る</Link>
                  )}
                  <button onClick={() => cancel(r)} disabled={busy === r.id}
                    className="flex-1 py-2 border border-red-200 rounded-lg text-sm text-red-600 disabled:opacity-40">取消（台帳から消す）</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
