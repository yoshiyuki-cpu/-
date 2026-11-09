// 良心マニフェストのグループの書き込みを読む部品（2026-11 社長の依頼）。DBにもLINEにも触らない。
// 書き込みは毎回ほぼ同じ形なので、AIを使わずに決まった読み方で読む（費用がかからず、結果がぶれない）。
//
//   11月9日(月)　東川西山　4トン      ← 日付・現場・トラック
//   処分B　廃材                        ← 処分場・廃材の種類
//   2560kg                            ← 量（t・kg・㎥・枚・台）か金額（8000円）
//
// トラックは読むだけで記録しない（車両代は経費確認のグループから拾う、社長の判断）。
// scripts/check-manifest-parse.mjs で検算できる。

export type ManifestText = {
  date: string            // YYYY-MM-DD
  siteText: string        // 現場の呼び名（例：西山、東川西山）
  truck: string | null    // 2トン など
  disposalText: string    // 処分場の呼び名（例：処分A）
  typeText: string        // 廃材の種類の呼び名（例：畳）
  quantity: number | null
  unit: string | null     // kg / t / ㎥ / 枚 / 台
  amount: number | null   // 円
  note: string | null     // 現金払い など、量と金額以外の残り
}

const toHalf = (s: string) => s.replace(/[０-９．，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
const words = (line: string) => line.split(/\s+/).map(w => w.trim()).filter(Boolean)

const UNIT_ALIASES: [RegExp, string][] = [
  [/^(kg|ｋｇ|キロ|キログラム)$/i, 'kg'],
  [/^(t|ｔ|トン|ton)$/i, 't'],
  [/^(㎥|m3|ｍ3|立米|りゅうべ)$/i, '㎥'],
  [/^枚$/, '枚'],
  [/^台$/, '台'],
]
function normalizeUnit(u: string) {
  for (const [re, name] of UNIT_ALIASES) if (re.test(u)) return name
  return null
}

// 年は書かれないので、今日から見て先の日付になるなら前の年とみなす
function resolveDate(month: number, day: number, today: string) {
  const [ty] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  let date = `${ty}-${pad(month)}-${pad(day)}`
  if (date > today) date = `${ty - 1}-${pad(month)}-${pad(day)}`
  return date
}

// マニフェストの形でなければ null（雑談など）
export function parseManifestText(raw: string, today: string): ManifestText | null {
  const lines = toHalf(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null

  // 1行目：日付・現場・トラック
  const head = lines[0]
  const dm = head.match(/(\d{1,2})\s*[月/／]\s*(\d{1,2})\s*日?/)
  if (!dm) return null
  const month = Number(dm[1]), day = Number(dm[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const rest = head.slice((dm.index ?? 0) + dm[0].length).replace(/^\s*[(（][^)）]*[)）]/, '')
  let truck: string | null = null
  const siteWords: string[] = []
  for (const w of words(rest)) {
    if (/^\d+(\.\d+)?\s*(トン|t|ｔ)(車)?$/i.test(w)) truck = w
    else siteWords.push(w)
  }
  const siteText = siteWords.join(' ')

  // 2行目：処分場・廃材の種類
  const mid = words(lines[1])
  if (!siteText || mid.length < 2) return null
  const disposalText = mid[0]
  const typeText = mid.slice(1).join(' ')

  // 3行目以降：量と金額
  let quantity: number | null = null, unit: string | null = null, amount: number | null = null
  const noteParts: string[] = []
  for (const line of lines.slice(2)) {
    let restLine = line
    const yen = restLine.match(/([\d,]+)\s*円/)
    if (yen) { amount = Number(yen[1].replace(/,/g, '')); restLine = restLine.replace(yen[0], ' ') }
    const q = restLine.match(/([\d,]*\.?\d+)\s*(kg|ｋｇ|キロ|t|ｔ|トン|㎥|m3|立米|枚|台)(?![a-zA-Zァ-ン])/i)
    if (q && quantity === null) {
      const u = normalizeUnit(q[2])
      if (u) { quantity = Number(q[1].replace(/,/g, '')); unit = u; restLine = restLine.replace(q[0], ' ') }
    }
    const left = restLine.trim()
    if (left) noteParts.push(left)
  }
  if (quantity === null && amount === null) return null

  return {
    date: resolveDate(month, day, today), siteText, truck, disposalText, typeText,
    quantity, unit, amount, note: noteParts.length ? noteParts.join(' ') : null,
  }
}

// ---- アプリの登録と突き合わせる ----

export type ManifestCtx = {
  projects: { id: number; name: string }[]
  disposalSites: { id: number; name: string }[]
  wasteTypes: { id: number; name: string; unit: string; unit_price: number; disposal_site_id: number }[]
}

export type ManifestProblem = 'site-unknown' | 'site-ambiguous' | 'disposal-unknown' | 'type-unknown' | 'unit-mismatch'

export type ManifestMatch = {
  candidates: { id: number; name: string }[]   // 現場の候補（1つなら決まり）
  wasteTypeId: number | null
  quantity: number | null   // 廃材の種類の単位に直した量
  amount: number | null     // 書かれた金額。無ければ null（単価から計算する）
  problem: ManifestProblem | null
}

const squash = (s: string) => toHalf(s).replace(/[\s　]/g, '').replace(/株式会社|有限会社|㈱|㈲/g, '').toLowerCase()

// 現場：現場名がそのまま入っている（東川西山 → 西山）か、呼び名が現場名に入っている（西山 → 西山町・西山谷）
export function matchProjects(siteText: string, projects: ManifestCtx['projects']) {
  const s = squash(siteText)
  if (!s) return []
  // 現場名の頭の地名だけを比べる（「東古松　ベルジャパン」の元請名で当たらないように）
  const place = (name: string) => squash(name.split(/[\s　]/)[0] || name)
  const exact = projects.filter(p => place(p.name) === s)
  if (exact.length) return exact
  const inText = projects.filter(p => place(p.name).length >= 2 && s.includes(place(p.name)))
  if (inText.length) {
    // 長く一致した現場を優先（東川西山 なら「西山」より「川西山」）
    const best = Math.max(...inText.map(p => place(p.name).length))
    return inText.filter(p => place(p.name).length === best)
  }
  return projects.filter(p => place(p.name).includes(s))
}

function convert(quantity: number, from: string, to: string): number | null {
  const t = to === 'トン' ? 't' : to
  if (from === t) return quantity
  if (from === 'kg' && t === 't') return Math.round((quantity / 1000) * 1000) / 1000
  if (from === 't' && t === 'kg') return Math.round(quantity * 1000 * 100) / 100
  return null
}

export function matchManifest(m: ManifestText, ctx: ManifestCtx): ManifestMatch {
  const candidates = matchProjects(m.siteText, ctx.projects)
  const base: ManifestMatch = { candidates, wasteTypeId: null, quantity: null, amount: m.amount, problem: null }

  const siteIds = ctx.disposalSites.filter(d => squash(d.name) === squash(m.disposalText)).map(d => d.id)
  if (!siteIds.length) return { ...base, problem: 'disposal-unknown' }
  const types = ctx.wasteTypes.filter(t => siteIds.includes(t.disposal_site_id))
  // 種類の名前は完全に一致するものを優先し、無ければ「書いた名前で始まるもの」
  let hit = types.filter(t => squash(t.name) === squash(m.typeText))
  if (!hit.length) hit = types.filter(t => squash(t.name).startsWith(squash(m.typeText)))
  // 同じ名前が単位違いである（同じ処分場の畳が kg と 枚）ときは、書かれた単位に合うものを選ぶ
  if (hit.length > 1 && m.unit) {
    const sameUnit = hit.filter(t => convert(1, m.unit as string, t.unit) !== null)
    if (sameUnit.length) hit = sameUnit
  }
  if (!hit.length) return { ...base, problem: 'type-unknown' }
  const type = [...hit].sort((a, b) => a.id - b.id)[0]

  let quantity: number | null = null
  if (m.quantity !== null && m.unit) {
    quantity = convert(m.quantity, m.unit, type.unit)
    if (quantity === null) return { ...base, wasteTypeId: type.id, problem: 'unit-mismatch' }
  } else if (m.amount !== null) {
    // 金額だけのときは、単価から量を逆算しておく（台帳の量の欄が空にならないように）
    quantity = type.unit_price > 0 ? Math.round((m.amount / type.unit_price) * 1000) / 1000 : 1
  }

  const problem: ManifestProblem | null = candidates.length === 0 ? 'site-unknown' : candidates.length > 1 ? 'site-ambiguous' : null
  return { ...base, wasteTypeId: type.id, quantity, problem }
}
