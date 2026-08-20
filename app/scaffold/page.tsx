'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase, ScaffoldMaterialPrice } from '@/lib/supabase'

import {
  STANDARD_LENGTHS, type Side, type SideResult,
  rectSides, calcSideResults, calcTatejiPipes, calcNunoPipes, calcJointCount,
} from '@/lib/scaffoldCalc'

type InputMode = 'directions' | 'rect' | 'perimeter'
type UsageRow = { key: string; label: string; count: string }

const USAGE_PRESETS = ['筋交い', '手すり', '幅木', 'ジョイント', 'ベース金具']

export default function ScaffoldCalcPage() {
  const keyCounter = useRef(0)
  const nextKey = () => `u${keyCounter.current++}`

  const [mode, setMode] = useState<InputMode>('directions')
  const [east, setEast] = useState('')
  const [west, setWest] = useState('')
  const [south, setSouth] = useState('')
  const [north, setNorth] = useState('')
  const [eastHeight, setEastHeight] = useState('')
  const [westHeight, setWestHeight] = useState('')
  const [southHeight, setSouthHeight] = useState('')
  const [northHeight, setNorthHeight] = useState('')
  const [depth, setDepth] = useState('')
  const [width, setWidth] = useState('')
  const [perimeterInput, setPerimeterInput] = useState('')
  const [height, setHeight] = useState('')
  const [spanInterval, setSpanInterval] = useState('1.8')
  const [levelHeight, setLevelHeight] = useState('1.8')
  // 建地の規格を直接指定できるようにする（nullなら高さに合わせて自動選択）
  const [tatejiLength, setTatejiLength] = useState<number | null>(null)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [materialPrices, setMaterialPrices] = useState<ScaffoldMaterialPrice[]>([])

  useEffect(() => {
    supabase.from('scaffold_material_prices').select('*').then(({ data }) => setMaterialPrices(data ?? []))
  }, [])

  const span = Number(spanInterval) || 0
  const level = Number(levelHeight) || 0
  const h = Number(height) || 0

  const perimeter =
    mode === 'directions' ? (Number(east) || 0) + (Number(west) || 0) + (Number(south) || 0) + (Number(north) || 0) :
    mode === 'rect' ? (Number(depth) || 0) * 2 + (Number(width) || 0) * 2 :
    Number(perimeterInput) || 0

  // 辺ごとに長さ・高さが違う前提でスパン数・段数を計算する。
  // 縦×横も4辺に展開する（全周をまとめて割ると角に建地が立たず本数が足りなくなるため）
  const sides: Side[] = mode === 'directions'
    ? [
        { label: '東', length: Number(east) || 0, height: Number(eastHeight) || 0 },
        { label: '西', length: Number(west) || 0, height: Number(westHeight) || 0 },
        { label: '南', length: Number(south) || 0, height: Number(southHeight) || 0 },
        { label: '北', length: Number(north) || 0, height: Number(northHeight) || 0 },
      ]
    : mode === 'rect'
    ? rectSides(Number(depth) || 0, Number(width) || 0, h)
    : [{ label: '全周', length: perimeter, height: h }]

  const sideResults: SideResult[] = calcSideResults(sides, span, level)

  const spanCount = sideResults.reduce((sum, s) => sum + s.spanCount, 0)
  const tatejiCount = spanCount
  const nunoCount = sideResults.reduce((sum, s) => sum + s.nuno, 0)

  const tatejiPipes = calcTatejiPipes(sideResults, tatejiLength)
  const nunoPipes = calcNunoPipes(sideResults)
  const jointCount = calcJointCount(sideResults, tatejiLength)
  const totalPipes = Object.fromEntries(
    STANDARD_LENGTHS.map(len => [len, (tatejiPipes[len] ?? 0) + (nunoPipes[len] ?? 0)])
  )

  const pipePrice = (len: number) => materialPrices.find(p => p.category === 'pipe' && p.label === String(len))?.unit_price ?? null
  const usagePrice = (label: string) => materialPrices.find(p => p.category === 'usage' && p.label === label)?.unit_price ?? null
  const pipeCostRows = STANDARD_LENGTHS.map(len => ({ len, price: pipePrice(len), count: totalPipes[len] ?? 0 }))
  const usageCostRows = usageRows
    .filter(r => r.label)
    .map(r => ({ label: r.label, price: usagePrice(r.label), count: Number(r.count) || 0 }))
  const pipeCost = pipeCostRows.reduce((sum, r) => sum + (r.price ?? 0) * r.count, 0)
  const usageCost = usageCostRows.reduce((sum, r) => sum + (r.price ?? 0) * r.count, 0)
  const totalCost = pipeCost + usageCost
  const hasUnsetPrice =
    pipeCostRows.some(r => r.count > 0 && r.price === null) || usageCostRows.some(r => r.count > 0 && r.price === null)

  // ベース金具は建地と同数、ジョイントは継手数から自動算出する。
  // 幅木・手すりは作業床のある段だけに入るもので段数が現場によって違うため、1周ぶんを初期値にする
  const usagePresetDefaultCount: Record<string, string> = {
    'ベース金具': tatejiCount > 0 ? String(tatejiCount) : '',
    'ジョイント': jointCount > 0 ? String(jointCount) : '',
    '幅木': spanCount > 0 ? String(spanCount) : '',
    '手すり': spanCount > 0 ? String(spanCount) : '',
  }

  function addUsageRow(label = '', count = '') {
    setUsageRows(rs => [...rs, { key: nextKey(), label, count }])
  }
  function updateUsageRow(key: string, patch: Partial<UsageRow>) {
    setUsageRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  }
  function removeUsageRow(key: string) {
    setUsageRows(rs => rs.filter(r => r.key !== key))
  }

  const inputClass = 'w-full border rounded px-3 py-3 text-base'
  const hasResult = span > 0 && level > 0 && sideResults.some(s => s.spanCount > 0 && s.levelCount > 0)

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
          <div className="flex flex-col gap-3">
            {([
              ['東', east, setEast, eastHeight, setEastHeight],
              ['西', west, setWest, westHeight, setWestHeight],
              ['南', south, setSouth, southHeight, setSouthHeight],
              ['北', north, setNorth, northHeight, setNorthHeight],
            ] as const).map(([label, len, setLen, ht, setHt]) => (
              <div key={label} className="border rounded p-3">
                <p className="text-sm font-medium mb-2">{label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">長さ（m）</label>
                    <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={len}
                      onChange={e => setLen(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">高さ（m）</label>
                    <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={ht}
                      onChange={e => setHt(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>
            ))}
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

        {mode !== 'directions' && (
          <div>
            <label className="block text-sm font-medium mb-1">建物の高さ（m）</label>
            <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={height}
              onChange={e => setHeight(e.target.value)} placeholder="0" />
          </div>
        )}

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

        <div className="mt-3">
          <label className="block text-sm font-medium mb-1">建地に使う単管</label>
          <div className="flex gap-1.5 flex-wrap">
            {([null, ...STANDARD_LENGTHS] as (number | null)[]).map(len => (
              <button key={len ?? 'auto'} type="button" onClick={() => setTatejiLength(len)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  tatejiLength === len ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                }`}>
                {len === null ? '自動' : `${len}m`}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {tatejiLength === null
              ? '高さをまかなえる最小の規格を選びます。'
              : `高さに関わらず${tatejiLength}m単管で建地を立てます（養生で建物より高く立ち上げる場合など）。足りない分は継ぎ足します。`}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mt-4">
        <h2 className="font-bold mb-3 text-gray-700">計算結果</h2>
        {!hasResult ? (
          <p className="text-gray-400 text-sm text-center py-2">寸法・高さを入力してください</p>
        ) : (
          <div className="flex flex-col gap-1">
            {mode === 'directions' && (
              <table className="w-full text-sm mb-2">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-gray-600">辺</th>
                    <th className="text-right py-2 font-medium text-gray-600">スパン数</th>
                    <th className="text-right py-2 font-medium text-gray-600">段数</th>
                    <th className="text-right py-2 font-medium text-gray-600">建地</th>
                    <th className="text-right py-2 font-medium text-gray-600">布</th>
                  </tr>
                </thead>
                <tbody>
                  {sideResults.map(s => (
                    <tr key={s.label} className="border-b last:border-0">
                      <td className="py-2">{s.label}</td>
                      <td className="py-2 text-right">{s.spanCount}</td>
                      <td className="py-2 text-right">{s.levelCount}</td>
                      <td className="py-2 text-right">{s.tateji}本</td>
                      <td className="py-2 text-right">{s.nuno}本</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-between items-center text-sm py-2 border-b">
              <span className="text-gray-600">スパン数合計</span>
              <span className="font-bold text-gray-900">{spanCount}スパン</span>
            </div>
            <div className="flex justify-between items-center text-sm py-2 border-b">
              <span className="text-gray-600">建地本数合計</span>
              <span className="font-bold text-gray-900">{tatejiCount}本</span>
            </div>
            <div className="flex justify-between items-center text-sm py-2">
              <span className="text-gray-600">布本数合計</span>
              <span className="font-bold text-gray-900">{nunoCount}本</span>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          {mode === 'directions'
            ? '辺（東西南北）ごとに、長さ÷スパン間隔・高さ÷段の高さを切り上げてから計算し、最後に合計しています。'
            : '周囲長÷スパン間隔でスパン数、高さ÷段の高さで段数を切り上げ計算しています。'}
          建地本数はスパン数と同数（周囲を一周する想定）、布本数はスパン数×段数（一側足場）。現場の形状や補強によって実際に必要な本数は変わるため、目安としてご利用ください。
        </p>
      </div>

      {hasResult && (
        <div className="bg-white rounded-lg shadow p-4 mt-4">
          <h2 className="font-bold mb-3 text-gray-700">単管の長さ別本数（6m・4m・3m・2m・1m）</h2>
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
            建地は辺の高さ、布は辺の長さを規格長の単管で通して継いだ場合の内訳です。どちらも必要な長さをまかなえる最小の規格を選びます。
          </p>
        </div>
      )}

      {hasResult && (
        <div className="bg-white rounded-lg shadow p-4 mt-4">
          <h2 className="font-bold mb-3 text-gray-700">資材コスト（概算）</h2>
          <div className="flex flex-col gap-1">
            {pipeCostRows.map(r => (
              <div key={r.len} className="flex justify-between items-center text-sm py-1 border-b last:border-0">
                <span>単管{r.len}m（{r.count}本）</span>
                <span>{r.price !== null ? `${(r.price * r.count).toLocaleString()}円` : '単価未設定'}</span>
              </div>
            ))}
            {usageCostRows.map(r => (
              <div key={r.label} className="flex justify-between items-center text-sm py-1 border-b last:border-0">
                <span>{r.label}（{r.count}本）</span>
                <span>{r.price !== null ? `${(r.price * r.count).toLocaleString()}円` : '単価未設定'}</span>
              </div>
            ))}
            <div className="flex justify-between items-center text-sm py-2 mt-1">
              <span className="text-gray-600 font-medium">合計（概算）</span>
              <span className="font-bold text-gray-900">{totalCost.toLocaleString()}円</span>
            </div>
          </div>
          {hasUnsetPrice && (
            <p className="text-xs text-gray-400 mt-2">
              単価未設定の項目は0円として合計しています。単価は<Link href="/master" className="text-blue-600">マスタ管理 &gt; 足場材料単価</Link>で設定できます。
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mt-4">
        <h2 className="font-bold mb-3 text-gray-700">用途別本数（手入力）</h2>
        <p className="text-xs text-gray-400 mb-3">
          ベース金具は建地本数、ジョイントは継手数を初期値にしています。幅木・手すりは作業床のある段だけに入るため1周ぶん（{spanCount}本）を初期値にしています。段数に応じて変更してください。
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {USAGE_PRESETS.map(p => (
            <button key={p} type="button" onClick={() => addUsageRow(p, usagePresetDefaultCount[p] ?? '')}
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
