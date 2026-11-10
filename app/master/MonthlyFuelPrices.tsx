'use client'
// 月ごとの燃料単価（2026-11 社長の依頼）。月初に「11月度　レギュラー○円・軽油○円」を入れておくと、
// 手入力の燃料代と、燃料カードのグループの写真の燃料代が、リットル数 × その月の単価で自動計算される。
import { useEffect, useState } from 'react'
import { supabase, FuelMonthlyPrice } from '@/lib/supabase'
import { monthLabel } from '@/lib/fuelPrice'

const KINDS = ['レギュラー', '軽油'] as const
type Kind = typeof KINDS[number]

// 日本時間の今月（'YYYY-MM'）と、その前後の月
function thisMonth() {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  return d.toISOString().slice(0, 7)
}
function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

export default function MonthlyFuelPrices() {
  const [rows, setRows] = useState<FuelMonthlyPrice[]>([])
  const [ready, setReady] = useState<boolean | null>(null) // null=読み込み中、false=SQL未実行
  const [drafts, setDrafts] = useState<Record<string, string>>({}) // key: `${month}|${kind}`
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ month: string; text: string } | null>(null)

  async function load() {
    const { data, error } = await supabase.from('fuel_monthly_prices').select('*').order('month', { ascending: false })
    if (error) { setReady(false); return }
    setRows((data ?? []) as FuelMonthlyPrice[])
    setReady(true)
  }
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false }
  }, [])

  const now = thisMonth()
  const priceOf = (month: string, kind: Kind) => rows.find(r => r.month === month && r.fuel_type === kind)?.unit_price
  // 来月・今月と、単価が入っている月（新しい順に12か月まで）
  const months = [...new Set([shiftMonth(now, 1), now, ...rows.map(r => r.month)])]
    .sort((a, b) => (a < b ? 1 : -1)).slice(0, 12)
  const missingNow = KINDS.filter(k => priceOf(now, k) == null)

  async function save(month: string) {
    const items = KINDS.map(kind => ({ kind, value: drafts[`${month}|${kind}`] ?? (priceOf(month, kind) != null ? String(priceOf(month, kind)) : '') }))
      .filter(i => i.value.trim() !== '')
    if (!items.length) { setMessage({ month, text: '単価を入れてください。' }); return }
    if (items.some(i => !(Number(i.value) > 0))) { setMessage({ month, text: '単価は0より大きい数字で入れてください。' }); return }
    setSaving(month)
    const { error } = await supabase.from('fuel_monthly_prices').upsert(
      items.map(i => ({ month, fuel_type: i.kind, unit_price: Number(i.value), updated_at: new Date().toISOString() })),
      { onConflict: 'month,fuel_type' },
    )
    setSaving(null)
    if (error) { setMessage({ month, text: `保存できませんでした（${error.message}）` }); return }
    setDrafts(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${month}|`))))
    setMessage({ month, text: '保存しました。' })
    load()
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
      <h2 className="font-bold mb-1 text-gray-700">月ごとの燃料単価</h2>
      <p className="text-xs text-gray-500 mb-3">
        毎月はじめに、その月のレギュラーと軽油の単価を入れてください。記録入力の燃料代と、LINEの燃料カードのグループの写真は、給油した日の月の単価 × リットル数で自動計算します。
        その月が未入力のときは、前の月の単価（それも無ければ下の基本単価）で計算します。
      </p>
      {ready === false && (
        <p className="text-sm text-red-600 mb-2">月ごとの単価の準備がまだです。Supabaseで supabase-schema-fuel-monthly-prices.sql を実行してください。</p>
      )}
      {ready && missingNow.length > 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">{monthLabel(now)}の{missingNow.join('と')}の単価が未入力です。</p>
      )}
      {ready && (
        <div className="flex flex-col">
          {months.map(month => (
            <div key={month} className="py-2 border-b last:border-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm w-14 ${month === now ? 'font-bold text-blue-700' : 'text-gray-700'}`}>{monthLabel(month)}</span>
                <span className="text-xs text-gray-400 w-14">{month.slice(0, 4)}年</span>
                {KINDS.map(kind => {
                  const key = `${month}|${kind}`
                  const saved = priceOf(month, kind)
                  return (
                    <label key={kind} className="flex items-center gap-1 text-xs text-gray-600">
                      {kind}
                      <input type="number" inputMode="decimal" step="0.01" aria-label={`${monthLabel(month)}の${kind}の単価`}
                        className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-20"
                        value={drafts[key] ?? (saved != null ? String(saved) : '')}
                        placeholder="未入力"
                        onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))} />
                      円/L
                    </label>
                  )
                })}
                <button onClick={() => save(month)} disabled={saving === month}
                  className="text-xs bg-blue-600 text-white rounded-xl px-3 py-1 disabled:opacity-50">
                  {saving === month ? '保存中' : '保存'}
                </button>
              </div>
              {message?.month === month && <p className="text-xs text-gray-500 mt-1">{message.text}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
