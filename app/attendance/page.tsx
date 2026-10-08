'use client'
import PlanTabs from '../PlanTabs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { useDeviceUser } from '@/lib/user'
import { logAction } from '@/lib/audit'

type Worker = { id: number; name: string; company_name: string | null }
type LaborEntry = {
  id: number
  date: string
  amount: number
  worker_id: number
  day_type: 'full' | 'half'
  projects: { name: string }
}
// 残業代（supabase-schema-labor-overtime.sql）。作業員ごと・日ごとに1つ
type Overtime = { id: number; worker_id: number; date: string; amount: number; note: string | null }

const pad = (n: number) => String(n).padStart(2, '0')
const yen = (n: number) => `${Math.round(n).toLocaleString()}円`

export default function AttendancePage() {
  const user = useDeviceUser()
  const [ty, tm, td] = jstToday().split('-').map(Number)
  const [year, setYear] = useState(ty)
  const [month, setMonth] = useState(tm)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [entries, setEntries] = useState<LaborEntry[]>([])
  const [overtime, setOvertime] = useState<Overtime[]>([])
  const [overtimeReady, setOvertimeReady] = useState(true)
  const [loading, setLoading] = useState(false)
  // 日ごとの出面で開いている日（月の中の日にち）
  const [day, setDay] = useState(td)
  // 入力中の残業代：worker_id -> { amount, note }
  const [draft, setDraft] = useState<Record<number, { amount: string; note: string }>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const dayRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const from = `${year}-${pad(month)}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const to = `${year}-${pad(month)}-${pad(lastDay)}`
      const [{ data: w }, { data: e }, ot] = await Promise.all([
        supabase.from('workers').select('*').order('name'),
        supabase.from('labor_entries').select('*, projects(name)').gte('date', from).lte('date', to).order('date'),
        supabase.from('labor_overtime').select('*').gte('date', from).lte('date', to),
      ])
      if (cancelled) return
      setWorkers((w ?? []) as Worker[])
      setEntries((e ?? []) as unknown as LaborEntry[])
      setOvertimeReady(!ot.error)
      setOvertime((ot.data ?? []) as Overtime[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [year, month])

  const daysInMonth = new Date(year, month, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const dayOfMonth = Math.min(day, daysInMonth)
  const dateStr = `${year}-${pad(month)}-${pad(dayOfMonth)}`

  // 作業員ごとの出勤日マップ: workerId -> { day -> [{現場名, 全日/半日}] }
  const attendanceMap = useMemo(() => {
    const map: Record<number, Record<number, { site: string; dayType: 'full' | 'half' }[]>> = {}
    workers.forEach(w => { map[w.id] = {} })
    entries.forEach(e => {
      // new Date('2026-08-01') はUTC解釈なので、端末のタイムゾーンによって日がずれる。日付の文字列をそのまま分解する
      const d = Number(e.date.split('-')[2])
      if (!map[e.worker_id]) return
      if (!map[e.worker_id][d]) map[e.worker_id][d] = []
      map[e.worker_id][d].push({ site: e.projects?.name ?? '', dayType: e.day_type ?? 'full' })
    })
    return map
  }, [workers, entries])

  const otMap = useMemo(() => {
    const map: Record<string, Overtime> = {}
    overtime.forEach(o => { map[`${o.worker_id}:${o.date}`] = o })
    return map
  }, [overtime])

  // 作業員ごとの月合計：日数（半日は0.5日）・残業代
  const totals = useMemo(() => {
    const t: Record<number, { days: number; overtime: number }> = {}
    workers.forEach(w => { t[w.id] = { days: 0, overtime: 0 } })
    entries.forEach(e => { if (t[e.worker_id]) t[e.worker_id].days += e.day_type === 'half' ? 0.5 : 1 })
    overtime.forEach(o => { if (t[o.worker_id]) t[o.worker_id].overtime += Number(o.amount) })
    return t
  }, [workers, entries, overtime])
  const totalOvertime = overtime.reduce((s, o) => s + Number(o.amount), 0)

  // 開いている日に働いた人（人工の記録がある人）と、その日に残業代だけ入っている人
  const dayWorkers = workers.filter(w => (attendanceMap[w.id]?.[dayOfMonth]?.length ?? 0) > 0 || otMap[`${w.id}:${dateStr}`])

  function openDay(d: number) {
    setDay(d)
    setDraft({})
    setMessage(null)
    dayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function shiftDay(diff: number) {
    const d = new Date(Date.UTC(year, month - 1, dayOfMonth + diff))
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1); setDay(d.getUTCDate())
    setDraft({}); setMessage(null)
  }

  const valueOf = (wid: number) => draft[wid] ?? {
    amount: otMap[`${wid}:${dateStr}`] ? String(Number(otMap[`${wid}:${dateStr}`].amount)) : '',
    note: otMap[`${wid}:${dateStr}`]?.note ?? '',
  }
  const changed = Object.keys(draft).map(Number)

  async function saveDay() {
    if (!changed.length) return
    setSaving(true); setMessage(null)
    let failed = false
    for (const wid of changed) {
      const v = draft[wid]
      const amount = Number(v.amount.replace(/[^0-9]/g, '')) || 0
      const existing = otMap[`${wid}:${dateStr}`]
      const name = workers.find(w => w.id === wid)?.name ?? ''
      if (amount === 0 && !v.note.trim()) {
        // 空にしたら消す（残業なしに戻す）
        if (existing) {
          const { error } = await supabase.from('labor_overtime').delete().eq('id', existing.id)
          if (error) failed = true
          else logAction(supabase, 'delete', 'labor_overtime', existing.id, `${name} の ${month}/${dayOfMonth} の残業代を消した`)
        }
        continue
      }
      const { error } = await supabase.from('labor_overtime').upsert({
        worker_id: wid, date: dateStr, amount, note: v.note.trim() || null,
        created_by: user?.name ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'worker_id,date' })
      if (error) { failed = true; continue }
      logAction(supabase, existing ? 'edit' : 'create', 'labor_overtime', existing?.id ?? null, `${name} の ${month}/${dayOfMonth} の残業代を ${yen(amount)} にした`)
    }
    const from = `${year}-${pad(month)}-01`
    const to = `${year}-${pad(month)}-${pad(daysInMonth)}`
    const { data } = await supabase.from('labor_overtime').select('*').gte('date', from).lte('date', to)
    setOvertime((data ?? []) as Overtime[])
    setSaving(false)
    if (failed) {
      setMessage({ ok: false, text: '一部を保存できませんでした。もう一度「保存」を押してください。' })
    } else {
      setDraft({})
      setMessage({ ok: true, text: `${month}/${dayOfMonth} の残業代を保存しました ✓` })
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = [ty - 1, ty, ty + 1]
  const wd = '日月火水木金土'[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()]

  return (
    <div>
      <PlanTabs />
      <h1 className="text-xl font-bold mb-4">出面集計表</h1>

      {/* 月選択 */}
      <div className="flex gap-2 mb-4">
        <select id="att-year" aria-label="年" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={year}
          onChange={e => { setYear(Number(e.target.value)); setDraft({}) }}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select id="att-month" aria-label="月" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={month}
          onChange={e => { setMonth(Number(e.target.value)); setDay(1); setDraft({}) }}>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
      </div>

      {loading && <p className="text-gray-500 text-sm">読み込み中...</p>}

      {!loading && workers.length === 0 && (
        <p className="text-gray-400 text-sm">作業員が登録されていません</p>
      )}

      {!loading && workers.length > 0 && (
        <>
          {/* 日ごとの出面と残業代 */}
          <section ref={dayRef} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 scroll-mt-20" aria-labelledby="day-title">
            <div className="flex items-center justify-between gap-2 mb-3">
              <button onClick={() => shiftDay(-1)} className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg" aria-label="前の日">←</button>
              <h2 id="day-title" className="font-bold text-gray-800">{month}/{dayOfMonth}（{wd}）の出面</h2>
              <button onClick={() => shiftDay(1)} className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg" aria-label="次の日">→</button>
            </div>

            {!overtimeReady && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-sm text-amber-900">
                残業代の準備がまだです。Supabaseで <span className="font-mono">supabase-schema-labor-overtime.sql</span> を実行すると入れられます。
              </div>
            )}

            {dayWorkers.length === 0 && <p className="text-sm text-gray-400 py-2">この日の人工の記録はありません。</p>}

            <div className="flex flex-col divide-y divide-gray-100">
              {dayWorkers.map(w => {
                const sites = attendanceMap[w.id]?.[dayOfMonth] ?? []
                const v = valueOf(w.id)
                return (
                  <div key={w.id} className="py-2.5">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-medium">{w.name}</span>
                      <span className="text-xs text-gray-500 text-right min-w-0 truncate">
                        {sites.map(x => x.dayType === 'half' ? `${x.site}（半日）` : x.site).join('・') || '人工の記録なし'}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <label className="sr-only" htmlFor={`ot-amount-${w.id}`}>{w.name}の残業代（円）</label>
                      <span className="relative w-32 shrink-0">
                        <input id={`ot-amount-${w.id}`} inputMode="numeric" disabled={!overtimeReady}
                          className="w-full border border-gray-200 rounded-lg pl-3 pr-8 py-2.5 text-base text-right disabled:bg-gray-50"
                          placeholder="残業代" value={v.amount}
                          onChange={e => setDraft(d => ({ ...d, [w.id]: { ...v, amount: e.target.value.replace(/[^0-9]/g, '') } }))} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">円</span>
                      </span>
                      <label className="sr-only" htmlFor={`ot-note-${w.id}`}>{w.name}の残業のメモ</label>
                      <input id={`ot-note-${w.id}`} disabled={!overtimeReady}
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2.5 text-base disabled:bg-gray-50"
                        placeholder="メモ（例：2時間）" value={v.note}
                        onChange={e => setDraft(d => ({ ...d, [w.id]: { ...v, note: e.target.value } }))} />
                    </div>
                  </div>
                )
              })}
            </div>

            {message && (
              <p className={`text-sm mt-2 rounded-lg px-3 py-2 ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</p>
            )}
            {dayWorkers.length > 0 && overtimeReady && (
              <button onClick={saveDay} disabled={!changed.length || saving}
                className="w-full mt-3 bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-40">
                {saving ? '保存中...' : changed.length ? `残業代を保存（${changed.length}人）` : '残業代を入れると保存できます'}
              </button>
            )}
            <p className="text-[11px] text-gray-400 mt-2">空にして保存すると、その日の残業代は消えます。下の表の日にちを押すと、その日を開きます。</p>
          </section>

          {/* 作業員別サマリー */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <h2 className="font-bold mb-3 text-gray-700">{year}年{month}月　作業員別集計</h2>
            <div className="flex flex-col gap-1">
              {workers.map(w => (
                <div key={w.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                  <div>
                    <span className="font-medium">{w.name}</span>
                    {w.company_name && <span className="text-gray-500 ml-1">（{w.company_name}）</span>}
                  </div>
                  <span className="text-right">
                    <span className="font-bold">{totals[w.id]?.days ?? 0}日</span>
                    {(totals[w.id]?.overtime ?? 0) > 0 && <span className="block text-xs text-amber-800">残業代 {yen(totals[w.id].overtime)}</span>}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center text-sm pt-2 font-bold">
                <span>合計</span>
                <span className="text-right">
                  {entries.reduce((s, e) => s + (e.day_type === 'half' ? 0.5 : 1), 0)}日
                  {totalOvertime > 0 && <span className="block text-xs text-amber-800">残業代 {yen(totalOvertime)}</span>}
                </span>
              </div>
            </div>
          </div>

          {/* 日別出面表 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-24">作業員</th>
                  {days.map(d => (
                    <th key={d} className="px-0.5 py-1 font-medium text-center min-w-7">
                      <button onClick={() => openDay(d)} aria-label={`${month}/${d}を開く`}
                        className={`w-7 h-7 rounded-full ${d === dayOfMonth ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{d}</button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium text-gray-600 text-right">合計</th>
                </tr>
              </thead>
              <tbody>
                {workers.map(w => (
                  <tr key={w.id} className="border-t">
                    <td className="px-3 py-2 sticky left-0 bg-white font-medium">
                      {w.name}
                      {w.company_name && <div className="text-gray-400 text-xs">{w.company_name}</div>}
                    </td>
                    {days.map(d => {
                      const dayEntries = attendanceMap[w.id]?.[d] ?? []
                      const dayUnits = dayEntries.reduce((s, x) => s + (x.dayType === 'half' ? 0.5 : 1), 0)
                      const ot = otMap[`${w.id}:${year}-${pad(month)}-${pad(d)}`]
                      const title = dayEntries.map(x => x.dayType === 'half' ? `${x.site}（半日）` : x.site).join(', ') + (ot ? ` 残業代${yen(Number(ot.amount))}` : '')
                      return (
                        <td key={d} className={`px-0.5 py-2 text-center ${d === dayOfMonth ? 'bg-blue-50' : ''}`}>
                          <button onClick={() => openDay(d)} title={title} aria-label={`${w.name} ${month}/${d}`} className="relative inline-block">
                            {dayUnits > 0 && dayUnits < 1 && (
                              <span className="inline-block w-5 h-5 bg-orange-400 text-white rounded-full text-xs leading-5">半</span>
                            )}
                            {dayUnits >= 1 && (
                              <span className="inline-block w-5 h-5 bg-blue-500 text-white rounded-full text-xs leading-5">○</span>
                            )}
                            {ot && Number(ot.amount) > 0 && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-white" aria-hidden="true" />
                            )}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-right font-bold whitespace-nowrap">
                      {totals[w.id]?.days ?? 0}日
                      {(totals[w.id]?.overtime ?? 0) > 0 && <div className="text-[10px] font-normal text-amber-800">{yen(totals[w.id].overtime)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">○＝全日、半＝半日、黄色の点＝残業代あり。残業代は、その日に入っていた現場へ人工の割合で分けて、現場の原価（人工費）にも入ります。</p>
        </>
      )}
    </div>
  )
}
