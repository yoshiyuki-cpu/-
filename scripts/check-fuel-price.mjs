// lib/fuelPrice.ts の検算（架空の単価）。node --experimental-strip-types scripts/check-fuel-price.mjs
import { pickFuelPrice, fuelAmount, fuelPriceNote, monthLabel } from '../lib/fuelPrice.ts'

const monthly = [
  { month: '2026-10', fuel_type: '軽油', unit_price: 150 },
  { month: '2026-10', fuel_type: 'レギュラー', unit_price: 170 },
  { month: '2026-11', fuel_type: '軽油', unit_price: 148.5 },
]
const base = [{ fuel_type: '軽油', unit_price: 145 }, { fuel_type: 'レギュラー', unit_price: 165 }]
let ng = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) ng++
  console.log(`${ok ? 'OK' : 'NG'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` （期待 ${JSON.stringify(want)}）`}`)
}

eq('11月の軽油はその月の単価', pickFuelPrice('2026-11-09', '軽油', monthly, base), { price: 148.5, month: '2026-11', from: 'month', usedMonth: '2026-11' })
eq('11月のレギュラーは未入力なので10月', pickFuelPrice('2026-11-09', 'レギュラー', monthly, base), { price: 170, month: '2026-11', from: 'earlier', usedMonth: '2026-10' })
eq('9月は前の月も無いので基本単価', pickFuelPrice('2026-09-30', '軽油', monthly, base), { price: 145, month: '2026-09', from: 'base', usedMonth: null })
eq('12月は11月の軽油を使う', pickFuelPrice('2026-12-01', '軽油', monthly, base).usedMonth, '2026-11')
eq('年をまたぐ（1月→前年12月以前）', pickFuelPrice('2027-01-05', 'レギュラー', monthly, base).usedMonth, '2026-10')
eq('単価がどこにも無い', pickFuelPrice('2026-11-09', '軽油', [], []), null)
eq('40.5L × 148.5円', fuelAmount(40.5, 148.5), 6014)
eq('四捨五入', fuelAmount(33.3, 150), 4995)
eq('月の表示', monthLabel('2026-01'), '1月度')
eq('注意（前の月）', fuelPriceNote(pickFuelPrice('2026-11-09', 'レギュラー', monthly, base)), '11月度の単価が未入力のため、10月度の単価 170円/L で計算')
console.log(ng ? `\n${ng}件ちがいます` : '\nすべて合っています')
process.exit(ng ? 1 : 0)
