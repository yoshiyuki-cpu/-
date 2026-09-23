'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { useDeviceUser, OWNER_USER } from '@/lib/user'
import { collectSiteStatus, classify, SiteStatus } from '@/lib/siteStatus'
import { buildMonthlyReport } from '@/lib/monthlyReport'

// ホームの「今日」。現場の一日の3つの時刻に合わせて、そのとき押すべきものだけを上に出す。
//   朝（〜12時）  … KY写真・議事録・道具の確認がまだの現場が上。済むまで人工・処分代は入力できない
//   夕方（12時〜）… 人工・処分代がまだの現場が上。「今日の記入」から1画面で入れる
//   社長・難波君 … 記入状況（抜け・済み・記録なし）と、LINE の確認待ち、今月の差引
// 黄色は「まだ」だけに使う。済んだら緑、動きのないものは灰色。

type Phase = 'morning' | 'evening'
type WorkerRow = { id: number; name: string; is_foreman?: boolean; receives_entry_report?: boolean }

function jstHour() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
}
function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${'日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`
}
const morningDone = (s: SiteStatus) => s.ky && s.minutes && (s.tools || !s.toolsRequired)

function Chip({ done, children }: { done: boolean | null; children: React.ReactNode }) {
  const cls = done === null
    ? 'bg-white border-gray-200 text-gray-500'
    : done ? 'bg-emerald-50 border-transparent text-emerald-700' : 'bg-amber-50 border-amber-400 text-amber-900'
  return <span className={`text-xs font-bold rounded-lg border px-2 py-1 whitespace-nowrap ${cls}`}>{children}</span>
}

export default function Today() {
  const user = useDeviceUser()
  const today = jstToday()
  const [phase, setPhase] = useState<Phase>(() => (jstHour() < 12 ? 'morning' : 'evening'))
  const [statuses, setStatuses] = useState<SiteStatus[]>([])
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [links, setLinks] = useState<{ worker_id: number; project_id: number }[]>([])
  const [dangers, setDangers] = useState<Record<number, string>>({})
  const [pendingLine, setPendingLine] = useState(0)
  const [month, setMonth] = useState<{ profit: number; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [asSite, setAsSite] = useState(false) // 社長が「職長の画面」を見るとき

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [st, { data: wk }, { data: fp }, { data: mn }, lr] = await Promise.all([
        collectSiteStatus(supabase, today),
        supabase.from('workers').select('*').order('name'),
        supabase.from('foreman_projects').select('worker_id, project_id'),
        supabase.from('meeting_notes').select('project_id, date, danger_points').order('date', { ascending: false }).limit(300),
        supabase.from('line_reports').select('id').eq('status', 'pending').limit(50),
      ])
      if (cancelled) return
      setStatuses(st)
      setWorkers((wk ?? []) as WorkerRow[])
      setLinks((fp ?? []) as { worker_id: number; project_id: number }[])
      // 現場ごとに一番新しい議事録の危険箇所
      const dz: Record<number, string> = {}
      for (const n of (mn ?? []) as { project_id: number; danger_points: string | null }[]) {
        if (!(n.project_id in dz) && n.danger_points) dz[n.project_id] = n.danger_points
      }
      setDangers(dz)
      setPendingLine(lr.error ? 0 : (lr.data ?? []).length)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [today])

  const isOwner = user?.id === OWNER_USER.id
  const me = workers.find(w => w.id === user?.id)
  const isManager = isOwner || me?.receives_entry_report === true
  const managerView = isManager && !asSite

  // 今月の差引は社長の画面でだけ引く（重いので）
  useEffect(() => {
    if (!managerView) return
    const [y, m] = today.split('-').map(Number)
    buildMonthlyReport(supabase, y, m).then(r => setMonth({ profit: r.totals.profit, total: r.totals.total })).catch(() => setMonth(null))
  }, [managerView, today])

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const foremanName = (projectId: number) =>
    links.filter(l => l.project_id === projectId).map(l => workers.find(w => w.id === l.worker_id)?.name).filter(Boolean).join('・')

  // ───────── 社長・難波君の画面 ─────────
  if (managerView) {
    const missing = statuses.filter(s => classify(s) === 'missing')
    const done = statuses.filter(s => classify(s) === 'done')
    const none = statuses.filter(s => classify(s) === 'none')
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs text-gray-500 font-mono">{dayLabel(today)}</p>
            <h1 className="text-xl font-bold">記入状況</h1>
          </div>
          <button onClick={() => setAsSite(true)} className="text-xs text-blue-600 underline py-2">職長の画面を見る</button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-white border border-gray-100 rounded-xl py-2.5"><p className="text-2xl font-bold font-mono text-red-700">{missing.length}</p><p className="text-[11px] font-bold text-gray-500">抜けあり</p></div>
          <div className="bg-white border border-gray-100 rounded-xl py-2.5"><p className="text-2xl font-bold font-mono text-emerald-700">{done.length}</p><p className="text-[11px] font-bold text-gray-500">記入済み</p></div>
          <div className="bg-white border border-gray-100 rounded-xl py-2.5"><p className="text-2xl font-bold font-mono text-gray-400">{none.length}</p><p className="text-[11px] font-bold text-gray-500">記録なし</p></div>
        </div>

        {missing.map(s => (
          <Link key={s.id} href={`/projects/${s.id}`} className="block bg-white rounded-2xl border border-amber-400 p-3">
            <div className="flex justify-between items-center gap-2">
              <span className="font-bold truncate">{s.name}</span>
              <Chip done={false}>抜け</Chip>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Chip done={s.ky}>KY{s.ky ? ' ✓' : ' まだ'}</Chip>
              <Chip done={s.minutes}>議事録{s.minutes ? ' ✓' : ' まだ'}</Chip>
              {s.toolsRequired && <Chip done={s.tools}>道具{s.tools ? ' ✓' : ' まだ'}</Chip>}
              <Chip done={s.labor > 0}>人工 {s.labor > 0 ? `${s.labor}名` : 'まだ'}</Chip>
              <Chip done={null}>処分 {s.waste > 0 ? `${s.waste}件` : 'なし'}</Chip>
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              {foremanName(s.id) ? `職長：${foremanName(s.id)}` : '職長：未設定'}{s.unlocked ? '　社長が解除した日' : ''}
            </p>
          </Link>
        ))}

        {pendingLine > 0 && (
          <Link href="/line-reports" className="flex justify-between items-center bg-white rounded-2xl border border-amber-400 p-3">
            <span className="text-sm font-bold">LINE報告　確認待ち</span>
            <Chip done={false}>{pendingLine}件</Chip>
          </Link>
        )}

        {done.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-3">
            <p className="text-xs font-bold text-gray-500">記入済み　{done.length}現場</p>
            <div className="flex flex-col mt-1">
              {done.map(s => (
                <Link key={s.id} href={`/projects/${s.id}`} className="flex justify-between py-1.5 text-sm">
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">人工{s.labor}名{s.waste ? `・処分${s.waste}件` : ''}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {none.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-3">
            <p className="text-xs font-bold text-gray-500">今日の記録なし（休工？）　{none.length}現場</p>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">{none.map(s => s.name).join('・')}</p>
          </div>
        )}

        <Link href="/report" className="block bg-white rounded-2xl border border-gray-100 p-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gray-500">{Number(today.slice(5, 7))}月の差引（今日まで）</span>
            <span className={`font-mono font-bold text-lg ${month && month.profit < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {month ? `${month.profit >= 0 ? '＋' : ''}${month.profit.toLocaleString()}円` : '集計中...'}
            </span>
          </div>
          {month && <p className="text-[11px] text-gray-500 mt-1">支出 {month.total.toLocaleString()}円　→ 月次レポートを開く</p>}
        </Link>

        <p className="text-[11px] text-gray-400 text-center">同じ内容を毎日19:30に LINE でお送りしています（マスタ → 通知設定）。</p>
      </div>
    )
  }

  // ───────── 職長の画面 ─────────
  const mine = user && user.id > 0 ? links.filter(l => l.worker_id === user.id).map(l => l.project_id) : []
  const sites = mine.length ? statuses.filter(s => mine.includes(s.id)) : statuses
  const needs = (s: SiteStatus) => (phase === 'morning' ? !morningDone(s) : classify(s) !== 'done')
  const ordered = [...sites].sort((a, b) => Number(needs(b)) - Number(needs(a)))
  const remaining = sites.filter(needs).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500 font-mono">{dayLabel(today)}</p>
          <h1 className="text-xl font-bold">今日の現場</h1>
        </div>
        <div className="grid grid-cols-2 bg-gray-200/70 rounded-xl p-1 gap-1 shrink-0" role="tablist" aria-label="朝と夕方の切り替え">
          {(['morning', 'evening'] as Phase[]).map(p => (
            <button key={p} role="tab" aria-selected={phase === p} onClick={() => setPhase(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold ${phase === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {p === 'morning' ? '朝' : '夕方'}
            </button>
          ))}
        </div>
      </div>

      {isManager && asSite && (
        <button onClick={() => setAsSite(false)} className="text-xs text-blue-600 underline self-start">記入状況（社長の画面）に戻る</button>
      )}
      {!user && (
        <p className="text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-3 py-2">
          右上の「名前を選ぶ」で名前を選ぶと、担当の現場だけが出ます。
        </p>
      )}
      {user && user.id > 0 && mine.length === 0 && (
        <p className="text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-3 py-2">
          担当の現場がまだ決まっていないので、全部の現場を出しています（現場詳細の「担当の職長」で決められます）。
        </p>
      )}

      <p className={`text-sm font-bold ${remaining ? 'text-amber-800' : 'text-emerald-700'}`}>
        {phase === 'morning'
          ? (remaining ? `朝の分がまだの現場 ${remaining}` : '朝の分はすべて済みました ✓')
          : (remaining ? `今日の記入がまだの現場 ${remaining}` : '今日の記入はすべて済みました ✓')}
      </p>

      {ordered.length === 0 && <p className="text-gray-400 text-center py-10 text-sm">進行中の現場がありません。</p>}

      {ordered.map(s => {
        const mDone = morningDone(s)
        const status = classify(s)
        const need = needs(s)
        const firstMissing = !s.ky ? { label: 'KY写真を撮る', href: `/projects/${s.id}/ky` }
          : !s.minutes ? { label: '議事録を書く', href: `/projects/${s.id}/minutes` }
          : s.toolsRequired && !s.tools ? { label: '道具を確認する', href: `/projects/${s.id}/tools` }
          : null
        const action = firstMissing && !s.unlocked ? firstMissing : { label: '今日の記入をする', href: `/projects/${s.id}/today` }
        return (
          <div key={s.id} className={`bg-white rounded-2xl border p-3 ${need ? 'border-amber-400' : 'border-gray-100'}`}>
            <div className="flex justify-between items-center gap-2">
              <Link href={`/projects/${s.id}`} className="font-bold truncate">{s.name}</Link>
              {phase === 'morning'
                ? <Chip done={mDone}>{mDone ? '朝の分 済' : 'まだ'}</Chip>
                : <Chip done={status === 'done' ? true : status === 'none' ? null : false}>{status === 'done' ? '記入済み' : status === 'none' ? '記録なし' : 'まだ'}</Chip>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Chip done={s.ky}>KY写真{s.ky ? ' ✓' : ''}</Chip>
              <Chip done={s.minutes}>議事録{s.minutes ? ' ✓' : ''}</Chip>
              {s.toolsRequired && <Chip done={s.tools}>道具{s.tools ? ' ✓' : ''}</Chip>}
              {phase === 'evening' && <>
                <Chip done={s.labor > 0}>人工{s.labor > 0 ? ` ${s.labor}名` : ''}</Chip>
                <Chip done={s.waste > 0 ? true : null}>処分{s.waste > 0 ? ` ${s.waste}件` : ''}</Chip>
                {s.other > 0 && <Chip done>経費 {s.other}件</Chip>}
              </>}
            </div>
            {phase === 'morning' && dangers[s.id] && (
              <p className="text-xs leading-relaxed mt-2 border-l-4 border-red-600 pl-2 text-gray-800 line-clamp-2">
                <b>危険箇所</b>　{dangers[s.id]}
              </p>
            )}
            {!mDone && !s.unlocked && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-dashed border-amber-400 rounded-lg px-2 py-1.5 mt-2">
                🔒 {[!s.ky && 'KY写真', !s.minutes && '議事録', s.toolsRequired && !s.tools && '道具の確認'].filter(Boolean).join('・')}が済むまで、人工・処分代は入力できません
              </p>
            )}
            <Link href={action.href}
              className={`mt-3 flex items-center justify-center min-h-12 rounded-xl font-bold text-base ${firstMissing && !s.unlocked ? 'bg-amber-400 text-gray-900' : 'bg-blue-900 text-white'}`}>
              {action.label}
            </Link>
          </div>
        )
      })}
    </div>
  )
}
