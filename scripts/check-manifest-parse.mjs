// マニフェストの読み取りを検算する。 node scripts/check-manifest-parse.mjs
// 書き込みの形は社長に見せてもらった実物に合わせ、現場・処分場の名前は架空にしてある。
import assert from 'node:assert/strict'
import { parseManifestText, matchManifest, matchProjects } from '../lib/manifestParse.ts'

const today = '2026-11-10'
const p = t => parseManifestText(t, today)

// 量がトン
let m = p('11月9日　西山　2トン\n処分A　畳\n0.71t')
assert.deepEqual(m, { date: '2026-11-09', siteText: '西山', truck: '2トン', disposalText: '処分A', typeText: '畳', quantity: 0.71, unit: 't', amount: null, note: null })
// 量が kg・曜日つき・全角スペース
m = p('11月9日(月)　東川西山　4トン\n処分B　廃材\n2560kg')
assert.equal(m.date, '2026-11-09'); assert.equal(m.siteText, '東川西山'); assert.equal(m.quantity, 2560); assert.equal(m.unit, 'kg')
// 金額だけ・備考
m = p('11月9日　西山　2トン\n処分C　コンガラ\n8000円　現金払い')
assert.equal(m.amount, 8000); assert.equal(m.quantity, null); assert.equal(m.note, '現金払い')
// 全角数字・スラッシュの日付・カンマ
m = p('１１/９　西山　４トン\n処分B　廃材\n3,880kg')
assert.equal(m.date, '2026-11-09'); assert.equal(m.quantity, 3880); assert.equal(m.truck, '4トン')
// 年をまたぐ（今日より先の日付は去年）
assert.equal(p('12月28日　西山　2トン\n処分A　畳\n1t').date, '2025-12-28')
// マニフェストではない書き込み
assert.equal(p('了解です'), null)
assert.equal(p('11月9日　西山\n処分A　畳'), null)   // 量も金額もない
assert.equal(p('明日は雨なので休みです'), null)

// 突き合わせ
const ctx = {
  projects: [{ id: 1, name: '西山町' }, { id: 2, name: '西山谷' }, { id: 3, name: '川西' }, { id: 4, name: '東古松　元請建設' }],
  disposalSites: [{ id: 10, name: '処分A' }, { id: 11, name: '処分B' }, { id: 12, name: '処分A' }],
  wasteTypes: [
    { id: 100, name: '畳', unit: 'kg', unit_price: 25, disposal_site_id: 10 },
    { id: 101, name: '廃材', unit: 'kg', unit_price: 12, disposal_site_id: 11 },
    { id: 102, name: '畳', unit: '枚', unit_price: 1000, disposal_site_id: 11 },
    { id: 103, name: 'がれき', unit: 'トン', unit_price: 5000, disposal_site_id: 12 },
  ],
}
// 呼び名が2つの現場に当たる → 決められない
let r = matchManifest(p('11月9日　西山　2トン\n処分A　畳\n0.71t'), ctx)
assert.deepEqual(r.candidates.map(c => c.id), [1, 2]); assert.equal(r.problem, 'site-ambiguous')
assert.equal(r.wasteTypeId, 100); assert.equal(r.quantity, 710)   // t → kg
// 現場名がそのまま入っている（東川西 → 川西）
assert.deepEqual(matchProjects('東川西', ctx.projects).map(c => c.id), [3])
// 元請名では当てない
assert.deepEqual(matchProjects('元請建設', ctx.projects).map(c => c.id), [])
r = matchManifest(p('11月9日　西山町　4トン\n処分B　廃材\n3880kg'), ctx)
assert.equal(r.problem, null); assert.deepEqual(r.candidates.map(c => c.id), [1]); assert.equal(r.quantity, 3880)
// 未登録の処分場
assert.equal(matchManifest(p('11月9日　西山町　2トン\n処分Z　コンガラ\n8000円'), ctx).problem, 'disposal-unknown')
// 登録のない種類
assert.equal(matchManifest(p('11月9日　西山町　2トン\n処分B　瓦\n1t'), ctx).problem, 'type-unknown')
// 同じ処分場名が2つある（処分A）ときも、種類で探せる。kg → トン
r = matchManifest(p('11月9日　西山町　2トン\n処分A　がれき\n2500kg'), ctx)
assert.equal(r.wasteTypeId, 103); assert.equal(r.quantity, 2.5)
// 単位が合わない（kg の種類に ㎥）
assert.equal(matchManifest(p('11月9日　西山町　2トン\n処分B　廃材\n3㎥'), ctx).problem, 'unit-mismatch')
// 金額だけのときは単価から量を逆算
r = matchManifest(p('11月9日　西山町　2トン\n処分B　廃材\n12000円'), ctx)
assert.equal(r.amount, 12000); assert.equal(r.quantity, 1000)

console.log('マニフェストの読み取り：すべて一致しました')
