'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import {
  fetchMonthCosts, monthRange, fmtCompact, fmtYen,
  COST_CATS, CAT_STYLES, DayCost,
} from '@/lib/dailyCost'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(y, m - 1, d).getDay()]
}

function shiftDate(date: string, diff: number) {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(y, m - 1, d + diff)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

export default function DailyCost() {
  const today = jstToday()
  // 見たい日が主役。カレンダーはその日を選ぶための道具として下に置く
  const [selected, setSelected] = useState(today)
  const [days, setDays] = useState<Record<string, DayCost>>({})
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  const [showCalendar, setShowCalendar] = useState(false)

  const [year, month] = selected.split('-').map(Number)
  const monthKey = `${year}-${month}`
  const loading = loadedMonth !== monthKey

  useEffect(() => {
    let cancelled = false
    fetchMonthCosts(supabase, year, month).then(result => {
      // 月を素早く切り替えたとき、古い月の結果が後から上書きしないようにする
      if (cancelled) return
      setDays(result)
      setLoadedMonth(`${year}-${month}`)
    })
    return () => { cancelled = true }
  }, [year, month])

  const { lastDay } = monthRange(year, month)
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ]
  const dateOf = (day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  // 月を移ったら、その月の1日を選んだ状態にする
  function shiftMonth(diff: number) {
    const next = new Date(year, month - 1 + diff, 1)
    setSelected(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`)
  }

  const monthTotal = Object.values(days).reduce((s, x) => s + x.total, 0)
  const monthScrap = Object.values(days).reduce((s, x) => s + x.scrap, 0)
  const maxDay = Math.max(1, ...Object.values(days).map(x => x.total))
  const detail = days[selected]

  return (
    <div>
      {/* その日の現場ごとの内訳。いちばん上に置く */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setSelected(shiftDate(selected, -1))}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前日</button>
          <div className="text-center">
            <h2 className="font-bold text-gray-700">
              {month}/{Number(selected.split('-')[2])}（{weekdayOf(selected)}）
            </h2>
            {selected !== today && (
              <button onClick={() => setSelected(today)} className="text-[11px] text-blue-600">今日にもどる</button>
            )}
          </div>
          <button onClick={() => setSelected(shiftDate(selected, 1))}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">翌日 →</button>
        </div>

        {loading && <p className="text-sm text-gray-400 py-6 text-center">読み込み中...</p>}

        {!loading && !detail && (
          <p className="text-sm text-gray-400 py-6 text-center">この日の記録はありません。</p>
        )}

        {!loading && detail && (
          <div className="flex flex-col gap-2">
            {detail.sites.map(s => (
              <div key={s.projectId} className="border border-gray-100 rounded-xl p-3">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-medium text-sm">{s.projectName}</span>
                  <span className="font-bold text-sm text-red-700">{fmtYen(s.total)}</span>
                </div>
                <div className="flex flex-col gap-0.5 text-xs">
                  {COST_CATS.filter(c => s.cost[c] > 0).map(c => (
                    <div key={c} className="flex justify-between">
                      <span className={CAT_STYLES[c]}>{c}</span>
                      <span className="text-gray-700">{fmtYen(s.cost[c])}</span>
                    </div>
                  ))}
                  {s.scrap > 0 && (
                    <div className="flex justify-between border-t border-gray-100 pt-0.5 mt-0.5">
                      <span className="text-blue-600">スクラップ収益</span>
                      <span className="text-blue-700">{fmtYen(s.scrap)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center border-t pt-2 font-bold text-sm">
              <span>この日の支出合計（{detail.sites.length}現場）</span>
              <span className="text-red-700">{fmtYen(detail.total)}</span>
            </div>
            {detail.scrap > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">スクラップ収益</span>
                <span className="text-blue-700 font-medium">{fmtYen(detail.scrap)}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 別の日を選ぶためのカレンダー。ふだんは畳んでおく */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <button onClick={() => setShowCalendar(v => !v)}
          className="w-full flex justify-between items-center">
          <span className="font-bold text-gray-700 text-sm">カレンダーから選ぶ</span>
          <span className="text-xs text-blue-600">{showCalendar ? '閉じる' : '開く'}</span>
        </button>

        {showCalendar && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => shiftMonth(-1)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前月</button>
              <span className="font-bold text-gray-700 text-sm">{year}年{month}月</span>
              <button onClick={() => shiftMonth(1)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">翌月 →</button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`text-center text-[10px] font-medium py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day === null) return <div key={`e${i}`} />
                const date = dateOf(day)
                const dc = days[date]
                const total = dc?.total ?? 0
                const isToday = date === today
                const isSelected = selected === date
                // 金額が大きい日ほど濃くして、かかった日がひと目で分かるようにする
                const heat = total === 0 ? 0 : Math.min(3, Math.ceil((total / maxDay) * 3))
                const heatBg = ['bg-white', 'bg-red-50', 'bg-red-100', 'bg-red-200'][heat]
                return (
                  <button key={date} onClick={() => setSelected(date)}
                    className={`min-h-[42px] rounded-lg border px-0.5 pt-0.5 pb-1 flex flex-col items-center justify-start
                      ${isSelected ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-100'} ${heatBg}`}>
                    <span className={`text-[10px] leading-none ${isToday ? 'bg-blue-600 text-white rounded-full px-1.5 py-0.5' : 'text-gray-500'}`}>
                      {day}
                    </span>
                    {total > 0 && (
                      <span className="text-[9px] leading-tight font-semibold text-red-700 mt-0.5 break-all">
                        {fmtCompact(total)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-2 gap-1 text-xs mt-3 border-t pt-2">
              <div className="text-gray-500">{month}月の支出合計</div>
              <div className="text-right font-bold text-red-700">{fmtYen(monthTotal)}</div>
              <div className="text-gray-500">{month}月のスクラップ収益</div>
              <div className="text-right font-medium text-blue-600">{fmtYen(monthScrap)}</div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
