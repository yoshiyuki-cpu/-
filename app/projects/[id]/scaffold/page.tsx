'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Project, ScaffoldPlan, ScaffoldSegment } from '@/lib/supabase'

type InputMode = 'directions' | 'rect' | 'perimeter'
type UsageRow = { key: string; label: string; count: string }
type Side = { label: string; length: number; height: number }
type SideResult = Side & { spanCount: number; levelCount: number; tateji: number; nuno: number }

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

function addPipeCounts(a: Record<number, number>, b: Record<number, number>): Record<number, number> {
  const result = { ...a }
  Object.entries(b).forEach(([len, count]) => { result[Number(len)] = (result[Number(len)] ?? 0) + count })
  return result
}

export default function ProjectScaffoldCalcPage() {
  const { id } = useParams()
  const router = useRouter()
  const keyCounter = useRef(0)
  const nextKey = () => `u${keyCounter.current++}`

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [planId, setPlanId] = useState<number | null>(null)

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
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])

  const span = Number(spanInterval) || 0
  const level = Number(levelHeight) || 0
  const h = Number(height) || 0

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [{ data: p }, { data: plan }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('scaffold_plans').select('*').eq('project_id', id).maybeSingle(),
    ])
    setProject(p ?? null)

    if (plan) {
      const scaffoldPlan = plan as ScaffoldPlan
      setPlanId(scaffoldPlan.id)
      setMode(scaffoldPlan.input_mode)
      setSpanInterval(String(scaffoldPlan.span_interval_m))
      setLevelHeight(String(scaffoldPlan.level_height_m))

      const { data: segs } = await supabase
        .from('scaffold_segments')
        .select('*')
        .eq('plan_id', scaffoldPlan.id)
        .order('order_index')
      const segments = (segs ?? []) as ScaffoldSegment[]
      const byLabel = (label: string) => segments.find(s => s.label === label)

      if (scaffoldPlan.input_mode === 'directions') {
        const e = byLabel('east'), w = byLabel('west'), s = byLabel('south'), n = byLabel('north')
        setEast(e ? String(e.length_m) : ''); setEastHeight(e ? String(e.height_m) : '')
        setWest(w ? String(w.length_m) : ''); setWestHeight(w ? String(w.height_m) : '')
        setSouth(s ? String(s.length_m) : ''); setSouthHeight(s ? String(s.height_m) : '')
        setNorth(n ? String(n.length_m) : ''); setNorthHeight(n ? String(n.height_m) : '')
      } else if (scaffoldPlan.input_mode === 'rect') {
        const d = byLabel('depth'), wd = byLabel('width')
        setDepth(d ? String(d.length_m) : ''); setWidth(wd ? String(wd.length_m) : '')
        setHeight(d ? String(d.height_m) : wd ? String(wd.height_m) : '')
      } else {
        const per = byLabel('perimeter')
        setPerimeterInput(per ? String(per.length_m) : '')
        setHeight(per ? String(per.height_m) : '')
      }
    }
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setSuccess('')

    const { data: upserted, error } = await supabase
      .from('scaffold_plans')
      .upsert(
        {
          id: planId ?? undefined,
          project_id: Number(id),
          input_mode: mode,
          span_interval_m: span,
          level_height_m: level,
        },
        { onConflict: 'project_id' },
      )
      .select()
      .single()

    if (error || !upserted) {
      setSaving(false)
      alert('保存に失敗しました')
      return
    }

    const savedPlanId = (upserted as ScaffoldPlan).id
    setPlanId(savedPlanId)

    const segmentsToSave =
      mode === 'directions'
        ? [
            { label: 'east', length_m: Number(east) || 0, height_m: Number(eastHeight) || 0 },
            { label: 'west', length_m: Number(west) || 0, height_m: Number(westHeight) || 0 },
            { label: 'south', length_m: Number(south) || 0, height_m: Number(southHeight) || 0 },
            { label: 'north', length_m: Number(north) || 0, height_m: Number(northHeight) || 0 },
          ]
        : mode === 'rect'
        ? [
            { label: 'depth', length_m: Number(depth) || 0, height_m: h },
            { label: 'width', length_m: Number(width) || 0, height_m: h },
          ]
        : [{ label: 'perimeter', length_m: Number(perimeterInput) || 0, height_m: h }]

    await supabase.from('scaffold_segments').delete().eq('plan_id', savedPlanId)
    await supabase.from('scaffold_segments').insert(
      segmentsToSave.map((seg, i) => ({ plan_id: savedPlanId, order_index: i, ...seg })),
    )

    setSaving(false)
    setSuccess('保存しました')
    setTimeout(() => setSuccess(''), 2000)
  }

  const perimeter =
    mode === 'directions' ? (Number(east) || 0) + (Number(west) || 0) + (Number(south) || 0) + (Number(north) || 0) :
    mode === 'rect' ? (Number(depth) || 0) * 2 + (Number(width) || 0) * 2 :
    Number(perimeterInput) || 0

  // 東西南北個別入力の場合は、辺ごとに長さ・高さが違う前提でスパン数・段数を計算する。
  // それ以外のモードは建物全体を1つの辺として扱い、これまでと同じ計算結果になる
  const sides: Side[] = mode === 'directions'
    ? [
        { label: '東', length: Number(east) || 0, height: Number(eastHeight) || 0 },
        { label: '西', length: Number(west) || 0, height: Number(westHeight) || 0 },
        { label: '南', length: Number(south) || 0, height: Number(southHeight) || 0 },
        { label: '北', length: Number(north) || 0, height: Number(northHeight) || 0 },
      ]
    : [{ label: '全周', length: perimeter, height: h }]

  const sideResults: SideResult[] = sides.map(s => {
    const spanCount = span > 0 && s.length > 0 ? Math.ceil(s.length / span) : 0
    const levelCount = level > 0 && s.height > 0 ? Math.ceil(s.height / level) : 0
    return { ...s, spanCount, levelCount, tateji: spanCount, nuno: spanCount * levelCount }
  })

  const spanCount = sideResults.reduce((sum, s) => sum + s.spanCount, 0)
  const tatejiCount = spanCount
  const nunoCount = sideResults.reduce((sum, s) => sum + s.nuno, 0)

  const tatejiPipes = sideResults.reduce(
    (acc, s) => addPipeCounts(acc, scalePipeCounts(pipeBreakdown(s.height, STANDARD_LENGTHS), s.tateji)),
    {} as Record<number, number>,
  )
  const nunoPipes = sideResults.reduce(
    (acc, s) => addPipeCounts(acc, scalePipeCounts(pipeBreakdown(span, STANDARD_LENGTHS), s.nuno)),
    {} as Record<number, number>,
  )
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
  const hasResult = span > 0 && level > 0 && sideResults.some(s => s.spanCount > 0 && s.levelCount > 0)

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">読み込み中...</p>
  }

  return (
    <div>
      <button type="button" onClick={() => router.push(`/projects/${id}`)} className="text-sm text-blue-600 mb-2">
        ← 現場詳細へ戻る
      </button>
      <h1 className="text-xl font-bold mb-1">足場計算（単管・一側足場）</h1>
      {project && <p className="text-sm text-gray-500 mb-4">{project.name}</p>}

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

        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
            {saving ? '保存中...' : 'この現場に保存'}
          </button>
          {success && <span className="text-sm text-green-600">{success}</span>}
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
            建地は辺（または全体）の高さを規格長で継いだ場合の内訳、布は1本あたりスパン間隔{span || 0}mに収まる規格1本の内訳です。
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
