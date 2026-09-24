'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'

// 処分場ごとの月の合計金額（2026-09 社長の依頼）。
// 処分場からの請求と突き合わせられるように、処分場 → 廃材の種類 → 現場 の順に内訳を出す。
// 買取（entry_type = revenue：鉄くずなど）は支払いと分けて出す。
// 金額は入力のときに「単価 × 数量」で決まった記録の金額をそのまま足している（単価を後で変えても過去は変わらない）。

type Row = {
  project_id: number
  date: string
  quantity: number
  amount: number
  waste_type_id: number
}
type WT = { id: number; name: string; unit: string; entry_type: 'cost' | 'revenue'; disposal_site_id: number }

const TREND_MONTHS = 6

function monthRange(y: number, m: number) {
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const next = new Date(Date.UTC(y, m, 1))
  const to = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { from, to }  // to は含まない
}
function shiftMonth(y: number, m: number, diff: number) {
  const d = new Date(Date.UTC(y, m - 1 + diff, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}
const yen = (n: number) => `${Math.round(n).toLocaleString()}円`
const qtyText = (q: number) => (Math.round(q * 1000) / 1000).toLocaleString()

// 1回の問い合わせは最大1000行なので、無くなるまで続きを取る（現場一覧と同じやり方）
async function fetchRows(from: string, to: string): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let i = 0; ; i += PAGE) {
    const { data } = await supabase.from('waste_entries')
      .select('project_id, date, quantity, amount, waste_type_id')
      .gte('date', from).lt('date', to).order('id').range(i, i + PAGE - 1)
    const chunk = (data ?? []) as Row[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

export default function DisposalMonthlyPage() {
  const [ty, tm] = jstToday().split('-').map(Number)
  const [ym, setYm] = useState({ y: ty, m: tm })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [types, setTypes] = useState<WT[]>([])
  const [sites, setSites] = useState<{ id: number; name: string }[]>([])
  const [projects, setProjects] = useState<Record<number, string>>({})
  const [open, setOpen] = useState<number | null>(null)
  const [loadedFor, setLoadedFor] = useState('')

  // 表示中の月を含む過去6か月分をまとめて引く（推移の表にも使う）
  const key = `${ym.y}-${ym.m}`
  useEffect(() => {
    let cancelled = false
    const start = shiftMonth(ym.y, ym.m, -(TREND_MONTHS - 1))
    const from = monthRange(start.y, start.m).from
    const to = monthRange(ym.y, ym.m).to
    Promise.all([
      fetchRows(from, to),
      supabase.from('waste_types').select('id, name, unit, entry_type, disposal_site_id'),
      supabase.from('disposal_sites').select('id, name').order('name'),
      supabase.from('projects').select('id, name'),
    ]).then(([r, { data: wt }, { data: ds }, { data: pj }]) => {
      if (cancelled) return
      setRows(r)
      setTypes((wt ?? []) as WT[])
      setSites((ds ?? []) as { id: number; name: string }[])
      const names: Record<number, string> = {}
      ;((pj ?? []) as { id: number; name: string }[]).forEach(p => { names[p.id] = p.name })
      setProjects(names)
      setLoadedFor(`${ym.y}-${ym.m}`)
    })
    return () => { cancelled = true }
  }, [ym.y, ym.m])

  const typeById = useMemo(() => new Map(types.map(t => [t.id, t])), [types])
  const siteName = (id: number) => sites.find(s => s.id === id)?.name ?? '（処分場不明）'

  // 表示中の月の、処分場ごとの集計
  const monthly = useMemo(() => {
    if (!rows) return []
    const { from, to } = monthRange(ym.y, ym.m)
    const bySite = new Map<number, {
      siteId: number; pay: number; buy: number; count: number
      types: Map<number, { qty: number; amount: number }>
      projects: Map<number, number>
    }>()
    for (const r of rows) {
      if (r.date < from || r.date >= to) continue
      const t = typeById.get(r.waste_type_id)
      const siteId = t?.disposal_site_id ?? 0
      if (!bySite.has(siteId)) bySite.set(siteId, { siteId, pay: 0, buy: 0, count: 0, types: new Map(), projects: new Map() })
      const s = bySite.get(siteId)!
      const amount = Number(r.amount)
      if (t?.entry_type === 'revenue') s.buy += amount; else s.pay += amount
      s.count++
      const tt = s.types.get(r.waste_type_id) ?? { qty: 0, amount: 0 }
      tt.qty += Number(r.quantity); tt.amount += amount
      s.types.set(r.waste_type_id, tt)
      s.projects.set(r.project_id, (s.projects.get(r.project_id) ?? 0) + (t?.entry_type === 'revenue' ? -amount : amount))
    }
    return [...bySite.values()].sort((a, b) => b.pay - a.pay)
  }, [rows, ym.y, ym.m, typeById])

  // 過去6か月の推移（処分場 × 月、支払いのみ）
  const trend = useMemo(() => {
    if (!rows) return { months: [] as { y: number; m: number }[], table: new Map<number, number[]>() }
    // 新しい月を左に（スマホでは右側が画面の外に出るので、表示中の月が最初に見えるように）
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(ym.y, ym.m, -i))
    const table = new Map<number, number[]>()
    for (const r of rows) {
      const t = typeById.get(r.waste_type_id)
      if (t?.entry_type === 'revenue') continue
      const [y, m] = r.date.split('-').map(Number)
      const idx = months.findIndex(x => x.y === y && x.m === m)
      if (idx < 0) continue
      const siteId = t?.disposal_site_id ?? 0
      if (!table.has(siteId)) table.set(siteId, Array(TREND_MONTHS).fill(0))
      table.get(siteId)![idx] += Number(r.amount)
    }
    return { months, table }
  }, [rows, ym.y, ym.m, typeById])

  const loading = rows === null || loadedFor !== key
  const totalPay = monthly.reduce((s, x) => s + x.pay, 0)
  const totalBuy = monthly.reduce((s, x) => s + x.buy, 0)
  const isFuture = ym.y > ty || (ym.y === ty && ym.m >= tm)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">処分場ごとの月の合計</h1>
        <p className="text-xs text-gray-500 mt-1">処分場からの請求と突き合わせるための画面です。入力された廃材の記録を、処分場ごとに足しています。</p>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setYm(shiftMonth(ym.y, ym.m, -1))} className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg bg-white">← 前月</button>
        <p className="text-lg font-bold">{ym.y}年{ym.m}月</p>
        <button onClick={() => setYm(shiftMonth(ym.y, ym.m, 1))} disabled={isFuture}
          className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg bg-white disabled:opacity-30">翌月 →</button>
      </div>

      {loading && <p className="text-center py-10 text-gray-500">集計中...</p>}

      {!loading && (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 p-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-bold text-gray-700">処分代の合計</span>
              <span className="font-bold text-lg text-red-700">{yen(totalPay)}</span>
            </div>
            {totalBuy > 0 && (
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs text-gray-500">買取（鉄くずなど）</span>
                <span className="text-sm font-bold text-blue-700">{yen(totalBuy)}</span>
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-1">{monthly.length}か所の処分場{ym.y === ty && ym.m === tm ? '（今日までの分）' : ''}</p>
          </div>

          {monthly.length === 0 && <p className="text-gray-400 text-center py-8 text-sm">この月の廃材の記録はありません。</p>}

          {monthly.map(s => {
            const expanded = open === s.siteId
            return (
              <div key={s.siteId} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <button type="button" onClick={() => setOpen(expanded ? null : s.siteId)} aria-expanded={expanded}
                  className="w-full text-left p-3 flex justify-between items-center gap-2">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{s.siteId ? siteName(s.siteId) : '（処分場不明）'}</span>
                    <span className="block text-[11px] text-gray-500">{s.count}件{s.buy > 0 ? `・買取 ${yen(s.buy)}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-red-700">{yen(s.pay)}</span>
                    <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-gray-100 px-3 pb-3">
                    <p className="text-xs font-bold text-gray-500 mt-2 mb-1">廃材の種類別</p>
                    <div className="flex flex-col divide-y divide-gray-100">
                      {[...s.types.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([tid, v]) => {
                        const t = typeById.get(tid)
                        return (
                          <div key={tid} className="flex justify-between items-baseline gap-2 py-1.5 text-sm">
                            <span className="min-w-0 truncate">{t?.name ?? '不明'}<span className="text-xs text-gray-500 ml-2">{qtyText(v.qty)}{t?.unit ?? ''}</span></span>
                            <span className={`shrink-0 font-medium ${t?.entry_type === 'revenue' ? 'text-blue-700' : ''}`}>{t?.entry_type === 'revenue' ? '買取 ' : ''}{yen(v.amount)}</span>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs font-bold text-gray-500 mt-3 mb-1">現場別</p>
                    <div className="flex flex-col divide-y divide-gray-100">
                      {[...s.projects.entries()].sort((a, b) => b[1] - a[1]).map(([pid, amount]) => (
                        <Link key={pid} href={`/projects/${pid}`} className="flex justify-between items-baseline gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-blue-700">{projects[pid] ?? `現場 #${pid}`}</span>
                          <span className="shrink-0 font-medium">{yen(amount)}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {trend.table.size > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-3">
              <p className="text-sm font-bold text-gray-700 mb-2">過去{TREND_MONTHS}か月の推移（処分代）</p>
              <div className="overflow-x-auto -mx-3 px-3">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-medium py-1 pr-2">処分場</th>
                      {trend.months.map(x => (
                        <th key={`${x.y}-${x.m}`} className={`text-right font-medium py-1 px-1 ${x.y === ym.y && x.m === ym.m ? 'text-gray-900' : ''}`}>{x.m}月</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...trend.table.entries()].sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0)).map(([sid, vals]) => (
                      <tr key={sid} className="border-t border-gray-100">
                        <td className="py-1.5 pr-2 max-w-[7em] truncate">{sid ? siteName(sid) : '不明'}</td>
                        {vals.map((v, i) => (
                          <td key={i} className={`py-1.5 px-1 text-right whitespace-nowrap ${i === 0 ? 'font-bold' : ''}`}>
                            {v ? Math.round(v / 1000).toLocaleString() : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">単位：千円（四捨五入）。左端が表示中の月です。</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
