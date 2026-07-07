'use client'
import { useState } from 'react'

type InputMode = 'perimeter' | 'sides'

export default function ScaffoldCalcPage() {
  const [mode, setMode] = useState<InputMode>('sides')
  const [depth, setDepth] = useState('')
  const [width, setWidth] = useState('')
  const [perimeterInput, setPerimeterInput] = useState('')
  const [height, setHeight] = useState('')
  const [spanInterval, setSpanInterval] = useState('1.8')
  const [levelHeight, setLevelHeight] = useState('1.8')

  const perimeter = mode === 'sides'
    ? (Number(depth) || 0) * 2 + (Number(width) || 0) * 2
    : Number(perimeterInput) || 0

  const span = Number(spanInterval) || 0
  const level = Number(levelHeight) || 0
  const h = Number(height) || 0

  const spanCount = span > 0 ? Math.ceil(perimeter / span) : 0
  const levelCount = level > 0 ? Math.ceil(h / level) : 0
  const tatejiCount = spanCount
  const nunoCount = spanCount * levelCount

  const inputClass = 'w-full border rounded px-3 py-3 text-base'
  const hasResult = perimeter > 0 && h > 0 && span > 0 && level > 0

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">足場計算（単管・一側足場）</h1>

      <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">建物の寸法の入力方法</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('sides')}
              className={`flex-1 py-2 rounded border text-sm font-medium ${mode === 'sides' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              縦×横から計算
            </button>
            <button type="button" onClick={() => setMode('perimeter')}
              className={`flex-1 py-2 rounded border text-sm font-medium ${mode === 'perimeter' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              周囲長を直接入力
            </button>
          </div>
        </div>

        {mode === 'sides' ? (
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
          周囲長÷スパン間隔でスパン数、高さ÷段の高さで段数を切り上げ計算。建地本数はスパン数と同数（周囲を一周する想定）、布本数はスパン数×段数（一側足場）。現場の形状や補強によって実際に必要な本数は変わるため、目安としてご利用ください。
        </p>
      </div>
    </div>
  )
}
