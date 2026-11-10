// lib/siteOff.ts の「休工」の文の読み方の検算（架空の現場名）。node scripts/check-site-off.mjs
import { parseOffText, siteShortName } from '../lib/siteOff.ts'

const sites = [
  { id: 1, name: '北町　元請建設' },
  { id: 2, name: '南市場' },
  { id: 3, name: '東山（解体）' },
  { id: 4, name: '西川　工務店' },
]
let ng = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) ng++
  console.log(`${ok ? 'OK' : 'NG'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` （期待 ${JSON.stringify(want)}）`}`)
}

eq('呼び名', sites.map(s => siteShortName(s.name)), ['北町', '南市場', '東山', '西川'])
eq('「以外」', parseOffText('今日は、北町と南市場以外は休工です', sites), { day: 'today', ids: [3, 4], except: true, named: true })
eq('名前だけ', parseOffText('東山 休工', sites), { day: 'today', ids: [3], except: false, named: true })
eq('明日', parseOffText('明日は西川と東山が休工', sites), { day: 'tomorrow', ids: [3, 4], except: false, named: true })
eq('名前なし → ボタン', parseOffText('休工', sites), { day: 'today', ids: [], except: false, named: false })
eq('全部', parseOffText('明日は全部休工', sites), { day: 'tomorrow', ids: [1, 2, 3, 4], except: false, named: true })
eq('休工の文ではない', parseOffText('山田 休み', sites), null)
eq('取消は読まない', parseOffText('休工を取り消し', sites), null)
console.log(ng ? `\n${ng}件ちがいます` : '\nすべて合っています')
process.exit(ng ? 1 : 0)
