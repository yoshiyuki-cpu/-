// 出面・経費確認のまとめの読み取りを検算する。 node scripts/check-demen-parse.mjs
// 書き込みの形は社長に見せてもらった実物に合わせ、名前・現場・処分場は架空にしてある。
import assert from 'node:assert/strict'
import { parseDemenText, matchWorker, matchVehicle, normalizeWasteName } from '../lib/demenParse.ts'

const today = '2026-11-10'
const sample = `11月9日　西山　元請建設

山田、川上、鈴木、徳さん

4人工　計28.5人工

2トン自社1台　計7.5台
2トンリース0台　計1台
4トンリース 1台　計3.5台
PC35　　1台　　計2.5台
pc78　　0台　計1.5台

処分A　廃材
2680キロ
2560キロ

処分B　木屑A
780キロ

処分C　ハイプラ
230キロ
180キロ

処分D　コンガラ
8000円　現金払い`

const d = parseDemenText(sample, today)
assert.equal(d.date, '2026-11-09')
assert.equal(d.siteText, '西山 元請建設')
assert.deepEqual(d.names, ['山田', '川上', '鈴木', '徳さん'])
assert.equal(d.labor, 4); assert.equal(d.laborTotal, 28.5)
assert.deepEqual(d.vehicles, [
  { text: '2トン', category: 'owned', count: 1, total: 7.5 },
  { text: '2トン', category: 'rental', count: 0, total: 1 },
  { text: '4トン', category: 'rental', count: 1, total: 3.5 },
  { text: 'PC35', category: null, count: 1, total: 2.5 },
  { text: 'pc78', category: null, count: 0, total: 1.5 },
])
assert.deepEqual(d.waste, [
  { disposalText: '処分A', typeText: '廃材', quantity: 2680, unit: 'kg', amount: null },
  { disposalText: '処分A', typeText: '廃材', quantity: 2560, unit: 'kg', amount: null },
  { disposalText: '処分B', typeText: '木屑A', quantity: 780, unit: 'kg', amount: null },
  { disposalText: '処分C', typeText: 'ハイプラ', quantity: 230, unit: 'kg', amount: null },
  { disposalText: '処分C', typeText: 'ハイプラ', quantity: 180, unit: 'kg', amount: null },
  { disposalText: '処分D', typeText: 'コンガラ', quantity: null, unit: null, amount: 8000 },
])
// 半日・累計なし・曜日つき
const h = parseDemenText('11月9日(月)　川西\n山田、川上\n1.5人工\n2トン自社0.5台', today)
assert.equal(h.labor, 1.5); assert.equal(h.laborTotal, null); assert.deepEqual(h.vehicles, [{ text: '2トン', category: 'owned', count: 0.5, total: null }])
// まとめではない書き込み
assert.equal(parseDemenText('了解です', today), null)
assert.equal(parseDemenText('11月9日　西山\n明日は雨で休みです\nよろしく', today), null)

// 作業員
const workers = [{ id: 1, name: '山田太郎' }, { id: 2, name: '山田友達（ひろ）' }, { id: 3, name: '川上次郎' }, { id: 4, name: '徳さん' }]
assert.deepEqual(matchWorker('山田', workers).map(w => w.id), [1, 2])   // 2人 → 聞き返す
assert.deepEqual(matchWorker('川上', workers).map(w => w.id), [3])
assert.deepEqual(matchWorker('徳さん', workers).map(w => w.id), [4])
assert.deepEqual(matchWorker('鈴木', workers).map(w => w.id), [])      // 未登録
// 車両
const vehicles = [
  { id: 3, name: '2t', category: 'rental', default_price: 7500 }, { id: 7, name: '2t', category: 'owned', default_price: 5000 },
  { id: 6, name: '4t', category: 'rental', default_price: 9000 }, { id: 11, name: 'PC78', category: 'owned', default_price: 5000 },
  { id: 13, name: 'PC78', category: 'rental', default_price: 19000 },
]
assert.equal(matchVehicle({ text: '2トン', category: 'owned', count: 1, total: null }, vehicles).id, 7)
assert.equal(matchVehicle({ text: '2トン', category: 'rental', count: 1, total: null }, vehicles).id, 3)
assert.equal(matchVehicle({ text: '4トン', category: 'rental', count: 1, total: null }, vehicles).id, 6)
assert.equal(matchVehicle({ text: 'pc78', category: null, count: 1, total: null }, vehicles).id, 11)   // 書いていなければ自社
assert.equal(matchVehicle({ text: 'PC200', category: null, count: 1, total: null }, vehicles), null)
assert.equal(normalizeWasteName('ハイプラ'), '廃プラ')

console.log('出面・経費確認の読み取り：すべて一致しました')
