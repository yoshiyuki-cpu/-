'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import {
  fetchMonthCosts, monthRange, fmtCompact, fmtYen,
  COST_CATS, CAT_STYLES, DayCost,
} from '@/lib/dailyCost'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export default function DailyCost() {
  const [y, m, d] = jstToday().split('-').map(Number)
  const [year, setYear] = useState(y)
  const [month, setMonth] = useState(m)
  const [days, setDays] = useState<Record<string, DayCost>>({})
  // 読み込み済みの月を持っておき、表示中の月と違えば「読み込み中」とする
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  // 今月を開いたときは今日の内訳を先に出しておく
  const [selected, setSelected] = useState<string | null>(jstToday())

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

  function shiftMonth(diff: number) {
    const next = new Date(year, month - 1 + diff, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
    setSelected(null)
  }

  const { lastDay } = monthRange(year, month)
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ]

  const dateOf = (day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const monthTotal = Object.values(days).reduce((s, x) => s + x.total, 0)
  const monthScrap = Object.values(days).reduce((s, x) => s + x.scrap, 0)
  const maxDay = Math.max(1, ...Object.values(days).map(x => x.total))
  const detail = selected ? days[selected] : null
  const isThisMonth = year === y && month === m

  return (
    <div>
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => shiftMonth(-1)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前月</button>
          <h2 className="font-bold text-gray-700">{year}年{month}月</h2>
          <button onClick={() => shiftMonth(1)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">翌月 →</button>
        </div>

        <div className="grid grid-cols-2 gap-1 text-sm mb-3">
          <div className="text-gray-600">支出合計</div>
          <div className="text-right font-bold text-red-700">{fmtYen(monthTotal)}</div>
          <div className="text-gray-600">スクラップ収益</div>
          <div className="text-right font-medium text-blue-600">{fmtYen(monthScrap)}</div>
        </div>

        {loading && <p className="text-sm text-gray-400 py-6 text-center">読み込み中...</p>}

        {!loading && (
          <>
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
                const isToday = isThisMonth && day === d
                const isSelected = selected === date
                // 金額が大きい日ほど濃くして、かかった日がひと目で分かるようにする
                const heat = total === 0 ? 0 : Math.min(3, Math.ceil((total / maxDay) * 3))
                const heatBg = ['bg-white', 'bg-red-50', 'bg-red-100', 'bg-red-200'][heat]
                return (
                  <button key={date} onClick={() => setSelected(isSelected ? null : date)}
                    className={`min-h-[46px] rounded-lg border px-0.5 pt-0.5 pb-1 flex flex-col items-center justify-start
                      ${isSelected ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-100'} ${heatBg}`}>
                    <span className={`text-[10px] leading-none ${isToday ? 'bg-blue-600 text-white rounded-full px-1.5 py-0.5' : 'text-gray-500'}`}>
                      {day}
                    </span>
                    {total > 0 && (
                      <span className="text-[9px] leading-tight font-semibold text-red-700 mt-0.5 break-all">
                        {fmtCompact(total)}
                      </span>
                    )}
                    {dc && dc.scrap > 0 && (
                      <span className="text-[9px] leading-tight text-blue-600 break-all">
                        +{fmtCompact(dc.scrap)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              赤字はその日の支出、青字はスクラップ収益。日をタップすると現場ごとの内訳が出ます。
            </p>
          </>
        )}
      </section>

      {selected && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold text-gray-700 mb-3">
            {Number(selected.split('-')[1])}/{Number(selected.split('-')[2])}
            （{WEEKDAYS[new Date(Number(selected.split('-')[0]), Number(selected.split('-')[1]) - 1, Number(selected.split('-')[2])).getDay()]}）の内訳
          </h2>

          {!detail && <p className="text-sm text-gray-400">この日の記録はありません。</p>}

          {detail && (
            <div className="flex flex-col gap-3">
              {detail.sites.map(s => (
                <div key={s.projectId} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-medium text-sm">{s.projectName}</span>
                    <span className="font-bold text-sm text-red-700">{fmtYen(s.total)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    {COST_CATS.filter(c => s.cost[c] > 0).map(c => (
                      <div key={c} className="flex justify-between col-span-2">
                        <span className={CAT_STYLES[c]}>{c}</span>
                        <span className="text-gray-700">{fmtYen(s.cost[c])}</span>
                      </div>
                    ))}
                    {s.scrap > 0 && (
                      <div className="flex justify-between col-span-2 border-t border-gray-100 pt-0.5 mt-0.5">
                        <span className="text-blue-600">スクラップ収益</span>
                        <span className="text-blue-700">{fmtYen(s.scrap)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center border-t pt-2 font-bold text-sm">
                <span>この日の支出合計</span>
                <span className="text-red-700">{fmtYen(detail.total)}</span>
              </div>
              {detail.scrap > 0 && (
                <div className="flex justify-between items-center text-sm -mt-2">
                  <span className="text-gray-600">スクラップ収益</span>
                  <span className="text-blue-700 font-medium">{fmtYen(detail.scrap)}</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
