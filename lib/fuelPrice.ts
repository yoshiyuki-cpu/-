// 燃料の単価を「給油した日の月」で決める部品（2026-11 社長の依頼）。DBには触らない。
// 燃料はガソリンカードで入れていてレシートに金額が出ないので、月初に入れた月ごとの単価 × リットル数で燃料代を出す。
// 決め方：その月の単価 → それより前でいちばん新しい月の単価 → 基本単価（fuel_prices）。
// scripts/check-fuel-price.mjs で検算できる。

export type FuelKind = '軽油' | 'レギュラー'
export type MonthlyFuelPrice = { month: string; fuel_type: string; unit_price: number }
export type BaseFuelPrice = { fuel_type: string; unit_price: number }

export type FuelPriceHit = {
  price: number
  month: string            // 給油した月（'YYYY-MM'）
  from: 'month' | 'earlier' | 'base'
  usedMonth: string | null // 前の月の単価を使ったときの、その月
}

export const monthOf = (date: string) => date.slice(0, 7)
// 「2026-11」→「11月度」
export const monthLabel = (month: string) => `${Number(month.slice(5, 7))}月度`

export function pickFuelPrice(date: string, fuelType: FuelKind, monthly: MonthlyFuelPrice[], base: BaseFuelPrice[]): FuelPriceHit | null {
  const month = monthOf(date)
  const same = monthly.filter(m => m.fuel_type === fuelType && Number(m.unit_price) > 0)
  const exact = same.find(m => m.month === month)
  if (exact) return { price: Number(exact.unit_price), month, from: 'month', usedMonth: month }
  const earlier = same.filter(m => m.month < month).sort((a, b) => (a.month < b.month ? 1 : -1))[0]
  if (earlier) return { price: Number(earlier.unit_price), month, from: 'earlier', usedMonth: earlier.month }
  const b = base.find(x => x.fuel_type === fuelType && Number(x.unit_price) > 0)
  if (b) return { price: Number(b.unit_price), month, from: 'base', usedMonth: null }
  return null
}

// 燃料代（円）。1円未満は四捨五入
export const fuelAmount = (liters: number, price: number) => Math.round(liters * price)

// 返事や画面に添える一言。その月の単価が無かったときだけ注意を出す
export function fuelPriceNote(hit: FuelPriceHit): string {
  const label = monthLabel(hit.month)
  if (hit.from === 'month') return `${label}の単価 ${hit.price.toLocaleString()}円/L で計算`
  if (hit.from === 'earlier') return `${label}の単価が未入力のため、${monthLabel(hit.usedMonth as string)}の単価 ${hit.price.toLocaleString()}円/L で計算`
  return `${label}の単価が未入力のため、基本単価 ${hit.price.toLocaleString()}円/L で計算`
}
