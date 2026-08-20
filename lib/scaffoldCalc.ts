// 足場（単管・一側足場）の拾い出し計算。
// グローバル電卓（/scaffold）と現場紐付け版（/projects/[id]/scaffold）の両方から使う。

export type Side = { label: string; length: number; height: number }
export type SideResult = Side & { spanCount: number; levelCount: number; tateji: number; nuno: number }

// 解体屋が自社で組む場合に手持ちする単管の規格長（大きい順）
export const STANDARD_LENGTHS = [6, 4, 3, 2, 1]

// 目標長を1本でまかなえる最小の規格長を返す。
// 高さ2.5mの建地に6m単管を使うような無駄を避けるため、常に最長を選ばず必要十分な規格を選ぶ。
function smallestCovering(target: number, descending: number[]) {
  return [...descending].reverse().find(l => l >= target - 1e-9) ?? descending[0]
}

// 目標長を規格長の単管で構成した場合の本数内訳を返す。
// 規格長の最大値以下なら1本で足りるので、その中で最小の規格を選ぶ。
// 超える場合は大きい規格から順に継ぎ足し、端数は1本でカバーできる最小の規格で埋める。
export function pipeBreakdown(target: number, lengths: number[]): Record<number, number> {
  if (target <= 0) return {}
  const descending = [...lengths].sort((a, b) => b - a)
  const maxLen = descending[0]

  if (target <= maxLen) return { [smallestCovering(target, descending)]: 1 }

  let remaining = target
  const counts: Record<number, number> = {}
  for (const len of descending) {
    const count = Math.floor(remaining / len + 1e-9)
    if (count > 0) {
      counts[len] = count
      remaining -= count * len
    }
  }
  if (remaining > 1e-9) {
    const len = smallestCovering(remaining, descending)
    counts[len] = (counts[len] ?? 0) + 1
  }
  return counts
}

// 建地に使う単管を指定された場合の内訳。
// 解体の養生足場では、建物が低くても埃を抑えるために長い建地をあえて立てるので、
// 高さに対して過剰な規格でもそのまま使えるようにする（6m指定・高さ2.5m → 6m×1本）。
// 指定より高い場合は指定の規格を継ぎ、端数だけ他の規格で埋める。
export function pipeBreakdownFixed(target: number, preferred: number, lengths: number[]): Record<number, number> {
  if (target <= 0 || preferred <= 0) return {}
  const descending = [...lengths].sort((a, b) => b - a)
  if (preferred >= target - 1e-9) return { [preferred]: 1 }

  const count = Math.floor(target / preferred + 1e-9)
  const counts: Record<number, number> = { [preferred]: count }
  const remaining = target - count * preferred
  if (remaining > 1e-9) {
    const len = smallestCovering(remaining, descending)
    counts[len] = (counts[len] ?? 0) + 1
  }
  return counts
}

// 建地1本ぶんの内訳。規格を指定していなければ高さに合わせて自動で選ぶ
function tatejiBreakdown(height: number, fixedLength: number | null): Record<number, number> {
  return fixedLength
    ? pipeBreakdownFixed(height, fixedLength, STANDARD_LENGTHS)
    : pipeBreakdown(height, STANDARD_LENGTHS)
}

export function scalePipeCounts(perUnit: Record<number, number>, units: number): Record<number, number> {
  return Object.fromEntries(Object.entries(perUnit).map(([len, count]) => [len, count * units]))
}

export function addPipeCounts(a: Record<number, number>, b: Record<number, number>): Record<number, number> {
  const result = { ...a }
  Object.entries(b).forEach(([len, count]) => { result[Number(len)] = (result[Number(len)] ?? 0) + count })
  return result
}

// 長方形（縦×横）を4辺に展開する。
// 全周をまとめて1辺として割ると角に建地が立たず本数が足りなくなるため、辺ごとに分けて計算する。
export function rectSides(depth: number, width: number, height: number): Side[] {
  return [
    { label: '横', length: width, height },
    { label: '縦', length: depth, height },
    { label: '横', length: width, height },
    { label: '縦', length: depth, height },
  ]
}

const pieceCount = (counts: Record<number, number>) => Object.values(counts).reduce((a, b) => a + b, 0)

export function calcSideResults(sides: Side[], span: number, level: number): SideResult[] {
  return sides.map(s => {
    const spanCount = span > 0 && s.length > 0 ? Math.ceil(s.length / span - 1e-9) : 0
    const levelCount = level > 0 && s.height > 0 ? Math.ceil(s.height / level - 1e-9) : 0
    // 布は1スパン1本ではなく、辺の長さを通しで継ぐので「その辺1段あたりの単管本数 × 段数」になる
    const nuno = levelCount > 0 ? pieceCount(pipeBreakdown(s.length, STANDARD_LENGTHS)) * levelCount : 0
    return { ...s, spanCount, levelCount, tateji: spanCount, nuno }
  })
}

// 建地：1本あたり「その辺の高さ」を規格長で継いだ内訳を、辺の建地本数ぶん積む
export function calcTatejiPipes(sideResults: SideResult[], fixedLength: number | null = null): Record<number, number> {
  return sideResults.reduce(
    (acc, s) => addPipeCounts(acc, scalePipeCounts(tatejiBreakdown(s.height, fixedLength), s.tateji)),
    {} as Record<number, number>,
  )
}

// 布：1スパンごとに切らず、辺の長さぶんを長い単管で通して継ぐ。
// 全スパンに継手が来る組み方は実際にはしないため、辺1本ぶんの内訳を段数ぶん積む。
export function calcNunoPipes(sideResults: SideResult[]): Record<number, number> {
  return sideResults.reduce(
    (acc, s) => addPipeCounts(acc, scalePipeCounts(pipeBreakdown(s.length, STANDARD_LENGTHS), s.levelCount)),
    {} as Record<number, number>,
  )
}

// 継手の数。1本の部材を n 本の単管で構成すると継手は n-1 箇所になる。
export function calcJointCount(sideResults: SideResult[], fixedLength: number | null = null): number {
  return sideResults.reduce((sum, s) => {
    const tatejiJoints = Math.max(0, pieceCount(tatejiBreakdown(s.height, fixedLength)) - 1) * s.tateji
    const nunoJoints = Math.max(0, pieceCount(pipeBreakdown(s.length, STANDARD_LENGTHS)) - 1) * s.levelCount
    return sum + tatejiJoints + nunoJoints
  }, 0)
}
