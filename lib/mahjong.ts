// 麻雀の手牌解析ロジック（和了判定・待ち計算・向聴数計算）
// 牌インデックス: 0-8=一萬〜九萬, 9-17=一筒〜九筒, 18-26=一索〜九索, 27-33=東南西北白發中

export const TILE_KINDS = 34

// mpsz形式のコード（1m〜9m, 1p〜9p, 1s〜9s, 1z〜7z）
export const TILE_CODES: string[] = [
  ...['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'],
  ...['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'],
  ...['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s'],
  ...['1z', '2z', '3z', '4z', '5z', '6z', '7z'],
]

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中']

export type Suit = 'm' | 'p' | 's' | 'z'

export function tileSuit(t: number): Suit {
  if (t < 9) return 'm'
  if (t < 18) return 'p'
  if (t < 27) return 's'
  return 'z'
}

export function tileNumber(t: number): number {
  return (t % 9) + 1
}

// 表示用ラベル（例: 一萬 → { main: '一', sub: '萬' }、東 → { main: '東' }）
export function tileLabel(t: number): { main: string; sub?: string } {
  const suit = tileSuit(t)
  if (suit === 'z') return { main: HONOR_NAMES[t - 27] }
  const n = tileNumber(t)
  if (suit === 'm') return { main: KANJI_NUM[n - 1], sub: '萬' }
  if (suit === 'p') return { main: String(n), sub: '筒' }
  return { main: String(n), sub: '索' }
}

// mpsz形式のコード → 牌インデックス（不正なら null。赤5 "0m" 等は 5 として扱う）
export function codeToTile(code: string): number | null {
  const m = /^([0-9])([mpsz])$/.exec(code.trim().toLowerCase())
  if (!m) return null
  let n = Number(m[1])
  const suit = m[2] as Suit
  if (n === 0) {
    if (suit === 'z') return null
    n = 5 // 赤ドラは通常の5として扱う
  }
  if (suit === 'm') return n - 1
  if (suit === 'p') return 9 + n - 1
  if (suit === 's') return 18 + n - 1
  return n >= 1 && n <= 7 ? 27 + n - 1 : null
}

export function tilesToCounts(tiles: number[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0)
  for (const t of tiles) counts[t]++
  return counts
}

// ---- 和了判定 ----

function canFormSets(counts: number[]): boolean {
  let i = 0
  while (i < TILE_KINDS && counts[i] === 0) i++
  if (i === TILE_KINDS) return true
  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3
    if (canFormSets(counts)) {
      counts[i] += 3
      return true
    }
    counts[i] += 3
  }
  // 順子（数牌のみ、9・8始まりの順子は不可）
  if (i < 27 && tileNumber(i) <= 7 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--
    if (canFormSets(counts)) {
      counts[i]++; counts[i + 1]++; counts[i + 2]++
      return true
    }
    counts[i]++; counts[i + 1]++; counts[i + 2]++
  }
  return false
}

function isStandardAgari(counts: number[]): boolean {
  for (let pair = 0; pair < TILE_KINDS; pair++) {
    if (counts[pair] < 2) continue
    counts[pair] -= 2
    const ok = canFormSets(counts)
    counts[pair] += 2
    if (ok) return true
  }
  return false
}

function isChiitoiAgari(counts: number[]): boolean {
  let pairs = 0
  for (let i = 0; i < TILE_KINDS; i++) {
    if (counts[i] !== 0 && counts[i] !== 2) return false
    if (counts[i] === 2) pairs++
  }
  return pairs === 7
}

const KOKUSHI_TILES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

function isKokushiAgari(counts: number[]): boolean {
  let hasPair = false
  for (let i = 0; i < TILE_KINDS; i++) {
    if (counts[i] === 0) continue
    if (!KOKUSHI_TILES.includes(i)) return false
    if (counts[i] === 2) hasPair = true
    else if (counts[i] !== 1) return false
  }
  return hasPair && KOKUSHI_TILES.every(t => counts[t] >= 1)
}

// 14枚（または副露を除いた 3n+2 枚）で和了形か
export function isAgari(counts: number[]): boolean {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total % 3 !== 2) return false
  if (total === 14 && (isChiitoiAgari(counts) || isKokushiAgari(counts))) return true
  return isStandardAgari(counts)
}

// ---- 向聴数 ----

function chiitoiShanten(counts: number[]): number {
  let pairs = 0
  let kinds = 0
  for (let i = 0; i < TILE_KINDS; i++) {
    if (counts[i] > 0) kinds++
    if (counts[i] >= 2) pairs++
  }
  return 6 - pairs + Math.max(0, 7 - kinds)
}

function kokushiShanten(counts: number[]): number {
  let kinds = 0
  let hasPair = false
  for (const t of KOKUSHI_TILES) {
    if (counts[t] > 0) kinds++
    if (counts[t] >= 2) hasPair = true
  }
  return 13 - kinds - (hasPair ? 1 : 0)
}

function standardShanten(counts: number[]): number {
  let best = 8

  function dfs(i: number, sets: number, partials: number, hasPair: boolean) {
    while (i < TILE_KINDS && counts[i] === 0) i++
    if (i === TILE_KINDS) {
      // 面子＋塔子はあわせて4ブロックまでしか使えない
      const usable = Math.min(partials, 4 - sets)
      const shanten = 8 - 2 * sets - usable - (hasPair ? 1 : 0)
      if (shanten < best) best = shanten
      return
    }
    // 刻子
    if (counts[i] >= 3) {
      counts[i] -= 3
      dfs(i, sets + 1, partials, hasPair)
      counts[i] += 3
    }
    // 順子
    if (i < 27 && tileNumber(i) <= 7 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--
      dfs(i, sets + 1, partials, hasPair)
      counts[i]++; counts[i + 1]++; counts[i + 2]++
    }
    // 対子（雀頭 or 刻子待ちの塔子として）
    if (counts[i] >= 2) {
      counts[i] -= 2
      if (!hasPair) dfs(i, sets, partials, true)
      dfs(i, sets, partials + 1, hasPair)
      counts[i] += 2
    }
    // 両面・辺張塔子
    if (i < 27 && tileNumber(i) <= 8 && counts[i + 1] > 0) {
      counts[i]--; counts[i + 1]--
      dfs(i, sets, partials + 1, hasPair)
      counts[i]++; counts[i + 1]++
    }
    // 嵌張塔子
    if (i < 27 && tileNumber(i) <= 7 && counts[i + 2] > 0) {
      counts[i]--; counts[i + 2]--
      dfs(i, sets, partials + 1, hasPair)
      counts[i]++; counts[i + 2]++
    }
    // この牌を使わずに飛ばす
    const saved = counts[i]
    counts[i] = 0
    dfs(i + 1, sets, partials, hasPair)
    counts[i] = saved
  }

  dfs(0, 0, 0, false)
  return best
}

// 向聴数（-1=和了, 0=聴牌, 1以上=n向聴）。13枚（3n+1枚）の手牌に対して計算する。
export function calcShanten(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0)
  let s = standardShanten(counts)
  if (total >= 13) {
    s = Math.min(s, chiitoiShanten(counts), kokushiShanten(counts))
  }
  return s
}

// ---- 待ち計算 ----

export type WaitInfo = {
  tile: number
  remaining: number // 自分の手牌から見えていない残り枚数（最大4）
}

// 13枚の手牌の待ち牌一覧（聴牌していなければ空配列）
export function calcWaits(counts: number[]): WaitInfo[] {
  const waits: WaitInfo[] = []
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] >= 4) continue
    counts[t]++
    const agari = isAgari(counts)
    counts[t]--
    if (agari) waits.push({ tile: t, remaining: 4 - counts[t] })
  }
  return waits
}

export type DiscardOption = {
  discard: number
  waits: WaitInfo[]
  totalRemaining: number
}

// 14枚の手牌について「何を切れば何待ちになるか」を列挙（聴牌が保てる打牌のみ）
export function calcDiscardOptions(counts: number[]): DiscardOption[] {
  const options: DiscardOption[] = []
  for (let d = 0; d < TILE_KINDS; d++) {
    if (counts[d] === 0) continue
    counts[d]--
    const waits = calcWaits(counts)
    counts[d]++
    if (waits.length > 0) {
      options.push({
        discard: d,
        waits,
        totalRemaining: waits.reduce((s, w) => s + w.remaining, 0),
      })
    }
  }
  // 待ちの枚数が多い順
  options.sort((a, b) => b.totalRemaining - a.totalRemaining)
  return options
}
