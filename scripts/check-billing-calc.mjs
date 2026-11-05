// 請求書の計算を検算する。 node scripts/check-billing-calc.mjs
// リポジトリが公開なので金額はすべて架空。計算の決まりは社長の見本3枚と同じ。
// 型の取り除きが標準で動く Node 23.6 以降で実行する。
import assert from 'node:assert/strict'
import {
  calcTotals, defaultInvoiceDates, defaultItemName, displayUnitPrice, excludeTax, prevMonth,
} from '../lib/billingCalc.ts'

const construction = amount => ({ line_type: 'construction', quantity: 1, unit_price: null, amount })
const daily = (quantity, unit_price) => ({ line_type: 'daily', quantity, unit_price, amount: Math.round(quantity * unit_price) })

// 工事代金だけ（金額は税込）
const a = [1650000, 1320000, 990000, 480000].map(construction)
assert.deepEqual(a.map(displayUnitPrice), [1500000, 1200000, 900000, 436364])
assert.deepEqual(calcTotals(a), { subtotal: 4036364, tax: 403636, total: 4440000, taxRate: 10 })

// 常用工事が混ざる（常用の金額は税抜で、別に10%を足す）
const b = [...[2200000, 333000].map(construction), daily(10, 15000), daily(1, 2500)]
assert.deepEqual(b.map(displayUnitPrice), [2000000, 302727, 15000, 2500])
assert.equal(b[2].amount, 150000)
assert.deepEqual(calcTotals(b), { subtotal: 2455227, tax: 245523, total: 2700750, taxRate: 10 })

// 日付
assert.deepEqual(defaultInvoiceDates('2026-10'), { issue_date: '2026-10-31', due_date: '2026-11-30' })
assert.deepEqual(defaultInvoiceDates('2026-08'), { issue_date: '2026-08-31', due_date: '2026-09-30' })
assert.deepEqual(defaultInvoiceDates('2026-12'), { issue_date: '2026-12-31', due_date: '2027-01-31' })
assert.deepEqual(defaultInvoiceDates('2028-01'), { issue_date: '2028-01-31', due_date: '2028-02-29' })
assert.equal(prevMonth('2027-01'), '2026-12')

// 品名の初期値
assert.equal(defaultItemName('岡山市北区○○1-2-3'), '岡山市北区○○地内　工事代金')
assert.equal(defaultItemName('倉敷市○○'), '倉敷市○○地内　工事代金')
assert.equal(defaultItemName(''), '')
assert.equal(excludeTax(0), 0)

console.log('請求書の計算：すべて一致しました')
