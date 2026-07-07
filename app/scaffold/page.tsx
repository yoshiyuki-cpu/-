'use client'
import { useRef, useState } from 'react'

type InputMode = 'directions' | 'rect' | 'perimeter'
type UsageRow = { key: string; label: string; count: string }

// 単管の規格長（大きい順）
const STANDARD_LENGTHS = [4, 3, 2, 1]
const USAGE_PRESETS = ['筋交い', '手すり', '幅木', 'ジョイント', 'ベース金具']

// 対象の部材1本分を規格長の単管で構成した場合の本数内訳を返す
// ・規格長の最大値以下に収まる場合は、それ以上の規格を1本選ぶ（短い部材を継ぐのは非現実的なため）
// ・規格長の最大値を超える場合は、大きい規格から順に継ぎ足す
function pipeBreakdown(target: number, lengths: number[]): Record<number, number> {
  if (target <= 0) return {}
  const descending = [...lengths].sort((a, b) => b - a)
  const maxLen = descending[0]

  if (target <= maxLen) {
    const chosen = [...descending].reverse().find(l => l >= target - 1e-9) ?? maxLen
    return { [chosen]: 1 }
  }

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
    const minLen = descending[descending.length - 1]
    counts[minLen] = (counts[minLen] ?? 0) + 1
  }
  return counts
}

function scalePipeCounts(perUnit: Record<number, number>, units: number): Record<number, number> {
  return Object.fromEntries(Object.entries(perUnit).map(([len, count]) => [len, count * units]))
}

export default function ScaffoldCalcPage() {
  const keyCounter = useRef(0)
  const nextKey = () => `u${keyCounter.current++}`

  const [mode, setMode] = useState<InputMode>('directions')
  const [east, setEast] = useState('')
  const [west, setWest] = useState('')
  const [south, setSouth] = useState('')
  const [north, setNorth] = useState('')
  const [depth, setDepth] = useState('')
  const [width, setWidth] = useState('')
  const [perimeterInput, setPerimeterInput] = useState('')
  const [height, setHeight] = useState('')
  const [spanInterval, setSpanInterval] = useState('1.8')
  const [levelHeight, setLevelHeight] = useState('1.8')
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])

  const sideLengths = [Number(east) || 0, Number(west) || 0, Number(south) || 0, Number(north) || 0]

  const perimeter =
    mode === 'directions' ? sideLengths.reduce((a, b) => a + b, 0) :
    mode === 'rect' ? (Number(depth) || 0) * 2 + (Number(width) || 0) * 2 :
    Number(perimeterInput) || 0

  const span = Number(spanInterval) || 0
  const level = Number(levelHeight) || 0
  const h = Number(height) || 0

  // 東西南北を個別入力している場合は、辺ごとに端数を切り上げてから合計する
  // （辺をまたいで通し計算するより、実際の足場の組み方に近い）
  const spanCount = span > 0
    ? (mode === 'directions'
      ? sideLengths.reduce((sum, len) => sum + (len > 0 ? Math.ceil(len / span) : 0), 0)
      : Math.ceil(perimeter / span))
    : 0
  const levelCount = level > 0 ? Math.ceil(h / level) : 0
  const tatejiCount = spanCount
  const nunoCount = spanCount * levelCount

  const tatejiPipes = scalePipeCounts(pipeBreakdown(h, STANDARD_LENGTHS), tatejiCount)
  const nunoPipes = scalePipeCounts(pipeBreakdown(span, STANDARD_LENGTHS), nunoCount)
  const totalPipes = Object.fromEntries(
    STANDARD_LENGTHS.map(len => [len, (tatejiPipes[len] ?? 0) + (nunoPipes[len] ?? 0)])
  )

  function addUsageRow(label = '') {
    setUsageRows(rs => [...rs, { key: nextKey(), label, count: '' }])
  }
  function updateUsageRow(key: string, patch: Partial<UsageRow>) {
    setUsageRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  }
  function removeUsageRow(key: string) {
    setUsageRows(rs => rs.filter(r => r.key !== key))
  }

  const inputClass = 'w-full border rounded px-3 py-3 text-base'
  const hasResult = perimeter > 0 && h > 0 && span > 0 && level > 0

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">足場計算（単管・一側足場）</h1>

      <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">建物の寸法の入力方法</label>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setMode('directions')}
              className={`py-2 rounded border text-sm font-medium ${mode === 'directions' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              東西南北
            </button>
            <button type="button" onClick={() => setMode('rect')}
              className={`py-2 rounded border text-sm font-medium ${mode === 'rect' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              縦×横
            </button>
            <button type="button" onClick={() => setMode('perimeter')}
              className={`py-2 rounded border text-sm font-medium ${mode === 'perimeter' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              周囲長
            </button>
          </div>
        </div>

        {mode === 'directions' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">東（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={east}
                onChange={e => setEast(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">西（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={west}
                onChange={e => setWest(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">南（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={south}
                onChange={e => setSouth(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">北（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={north}
                onChange={e => setNorth(e.target.value)} placeholder="0" />
            </div>
          </div>
        ) : mode === 'rect' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">縦（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={depth}
                onChange={e => setDepth(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">横（m）</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={width}
                onChange={e => setWidth(e.target.value)} placeholder="0" />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">周囲長（m）</label>
            <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={perimeterInput}
              onChange={e => setPerimeterInput(e.target.value)} placeholder="0" />
          </div>
        )}

        {perimeter > 0 && (
          <p className="text-sm text-gray-500">周囲長: <span className="font-medium text-gray-800">{perimeter.toFixed(1)}m</span></p>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">建物の高さ（m）</label>
          <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={height}
            onChange={e => setHeight(e.target.value)} placeholder="0" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">スパン間隔（m）</label>
            <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={spanInterval}
              onChange={e => setSpanInterval(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">段の高さ（m）</label>
            <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={levelHeight}
              onChange={e => setLevelHeight(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mt-4">
        <h2 className="font-bold mb-3 text-gray-700">計算結果</h2>
        {!hasResult ? (
          <p className="text-gray-400 text-sm text-center py-2">寸法・高さを入力してください</p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-sm py-2 border-b">
              <span className="text-gray-600">スパン数</span>
              <span className="font-bold text-gray-900">{spanCount}スパン</span>
            </div>
            <div className="flex justify-between items-center text-sm py-2 border-b">
              <span className="text-gray-600">段数</span>
              <span className="font-bold text-gray-900">{levelCount}段</span>
            </div>
            <div className="flex justify-between items-center text-sm py-2 border-b">
              <span className="text-gray-600">建地本数</span>
              <span className="font-bold text-gray-900">{tatejiCount}本</span>
            </div>
            <div className="flex justify-between items-center text-sm py-2">
              <span className="text-gray-600">布本数</span>
              <span className="font-bold text-gray-900">{nunoCount}本</span>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          {mode === 'directions'
            ? '東西南北それぞれの辺の長さ÷スパン間隔を切り上げてから合計しています。'
            : '周囲長÷スパン間隔でスパン数を切り上げ計算しています。'}
          高さ÷段の高さで段数を切り上げ計算。建地本数はスパン数と同数（周囲を一周する想定）、布本数はスパン数×段数（一側足場）。現場の形状や補強によって実際に必要な本数は変わるため、目安としてご利用ください。
        </p>
      </div>

      {hasResult && (
        <div className="bg-white rounded-lg shadow p-4 mt-4">
          <h2 className="font-bold mb-3 text-gray-700">単管の長さ別本数（4m・3m・2m・1m）</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium text-gray-600">長さ</th>
                <th className="text-right py-2 font-medium text-gray-600">建地用</th>
                <th className="text-right py-2 font-medium text-gray-600">布用</th>
                <th className="text-right py-2 font-medium text-gray-600">合計</th>
              </tr>
            </thead>
            <tbody>
              {STANDARD_LENGTHS.map(len => (
                <tr key={len} className="border-b last:border-0">
                  <td className="py-2">{len}m</td>
                  <td className="py-2 text-right">{tatejiPipes[len] ?? 0}本</td>
                  <td className="py-2 text-right">{nunoPipes[len] ?? 0}本</td>
                  <td className="py-2 text-right font-bold">{totalPipes[len] ?? 0}本</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-3">
            建地は1本あたり高さ{h || 0}mを規格長で継いだ場合の内訳、布は1本あたりスパン間隔{span || 0}mに収まる規格1本の内訳です。
          </p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mt-4">
        <h2 className="font-bold mb-3 text-gray-700">用途別本数（手入力）</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {USAGE_PRESETS.map(p => (
            <button key={p} type="button" onClick={() => addUsageRow(p)}
              className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">+ {p}</button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {usageRows.map(row => (
            <div key={row.key} className="flex items-center gap-2">
              <input className="flex-1 border rounded px-3 py-2 text-sm" value={row.label} placeholder="用途名（例：筋交い）"
                onChange={e => updateUsageRow(row.key, { label: e.target.value })} />
              <input type="number" inputMode="numeric" className="w-20 border rounded px-3 py-2 text-sm" value={row.count} placeholder="本数"
                onChange={e => updateUsageRow(row.key, { count: e.target.value })} />
              <span className="text-sm text-gray-500 shrink-0">本</span>
              <button type="button" onClick={() => removeUsageRow(row.key)} className="text-gray-300 hover:text-red-400 text-xs shrink-0">削除</button>
            </div>
          ))}
          {usageRows.length === 0 && <p className="text-gray-400 text-sm text-center py-2">項目がありません</p>}
          <button type="button" onClick={() => addUsageRow()} className="text-blue-600 text-sm text-left">+ 項目を追加</button>
        </div>
      </div>
    </div>
  )
}
