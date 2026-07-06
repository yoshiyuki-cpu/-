'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Worker = { id: number; name: string; company_name: string | null }
type LaborEntry = {
  id: number
  date: string
  amount: number
  worker_id: number
  day_type: 'full' | 'half'
  projects: { name: string }
}

export default function AttendancePage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [entries, setEntries] = useState<LaborEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)
    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const [{ data: w }, { data: e }] = await Promise.all([
      supabase.from('workers').select('*').order('name'),
      supabase.from('labor_entries')
        .select('*, projects(name)')
        .gte('date', from)
        .lte('date', to)
        .order('date'),
    ])
    setWorkers(w ?? [])
    setEntries((e as any) ?? [])
    setLoading(false)
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // 作業員ごとの出勤日マップ: workerId -> { day -> [{現場名, 全日/半日}] }
  const attendanceMap: Record<number, Record<number, { site: string; dayType: 'full' | 'half' }[]>> = {}
  workers.forEach(w => { attendanceMap[w.id] = {} })
  entries.forEach(e => {
    const day = new Date(e.date).getDate()
    if (!attendanceMap[e.worker_id]) return
    if (!attendanceMap[e.worker_id][day]) attendanceMap[e.worker_id][day] = []
    attendanceMap[e.worker_id][day].push({ site: e.projects?.name ?? '', dayType: e.day_type ?? 'full' })
  })

  // 作業員ごとの月合計日数・金額（半日は0.5日でカウント）
  const totals: Record<number, { days: number; amount: number }> = {}
  workers.forEach(w => {
    const workerEntries = entries.filter(e => e.worker_id === w.id)
    totals[w.id] = {
      days: workerEntries.reduce((s, e) => s + (e.day_type === 'half' ? 0.5 : 1), 0),
      amount: workerEntries.reduce((s, e) => s + Number(e.amount), 0),
    }
  })

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">出面集計表</h1>

      {/* 月選択 */}
      <div className="flex gap-2 mb-4">
        <select className="border rounded px-3 py-2 text-sm" value={year}
          onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select className="border rounded px-3 py-2 text-sm" value={month}
          onChange={e => setMonth(Number(e.target.value))}>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
      </div>

      {loading && <p className="text-gray-500 text-sm">読み込み中...</p>}

      {!loading && workers.length === 0 && (
        <p className="text-gray-400 text-sm">作業員が登録されていません</p>
      )}

      {/* 作業員別サマリー */}
      {!loading && workers.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <h2 className="font-bold mb-3 text-gray-700">{year}年{month}月　作業員別集計</h2>
            <div className="flex flex-col gap-1">
              {workers.map(w => (
                <div key={w.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                  <div>
                    <span className="font-medium">{w.name}</span>
                    {w.company_name && <span className="text-gray-500 ml-1">（{w.company_name}）</span>}
                  </div>
                  <span className="font-bold">{totals[w.id]?.days ?? 0}日</span>
                </div>
              ))}
              <div className="flex justify-between items-center text-sm pt-2 font-bold">
                <span>合計</span>
                <span>{entries.reduce((s, e) => s + (e.day_type === 'half' ? 0.5 : 1), 0)}日</span>
              </div>
            </div>
          </div>

          {/* 日別出面表 */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-24">作業員</th>
                  {days.map(d => (
                    <th key={d} className="px-1 py-2 font-medium text-gray-600 text-center min-w-6">{d}</th>
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
                      const title = dayEntries.map(x => x.dayType === 'half' ? `${x.site}（半日）` : x.site).join(', ')
                      return (
                        <td key={d} className="px-1 py-2 text-center">
                          {dayUnits > 0 && dayUnits < 1 && (
                            <span title={title} className="inline-block w-5 h-5 bg-orange-400 text-white rounded-full text-xs leading-5 cursor-default">
                              半
                            </span>
                          )}
                          {dayUnits >= 1 && (
                            <span title={title} className="inline-block w-5 h-5 bg-blue-500 text-white rounded-full text-xs leading-5 cursor-default">
                              ○
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-right font-bold">{totals[w.id]?.days ?? 0}日</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
