'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Project, ScaffoldPlan, ScaffoldSegment } from '@/lib/supabase'

type InputMode = 'directions' | 'rect' | 'perimeter' | 'trace'
type UsageRow = { key: string; label: string; count: string }
type Side = { label: string; length: number; height: number }
type SideResult = Side & { spanCount: number; levelCount: number; tateji: number; nuno: number }
type Point = { x: number; y: number }

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

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// スマホカメラの写真は数MB〜十数MBあり、そのままアップロードするとモバイルブラウザが重くなるため
// 送信前に縮小・JPEG化する（他画面のresizeImageToBase64と同じ考え方でBlobを返す版）
function resizeImageToBlob(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(objectUrl)
      if (!ctx) { reject(new Error('canvas unsupported')); return }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')) }
    img.src = objectUrl
  })
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

  // 図面トレース（Phase 2）
  const [traceImageUrl, setTraceImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [traceSubMode, setTraceSubMode] = useState<'calibrate' | 'trace'>('calibrate')
  const [calibPoints, setCalibPoints] = useState<Point[]>([])
  const [calibLengthInput, setCalibLengthInput] = useState('')
  const [scaleMPerPx, setScaleMPerPx] = useState<number | null>(null)
  const [vertices, setVertices] = useState<Point[]>([])
  const [polygonClosed, setPolygonClosed] = useState(false)
  const [segmentHeights, setSegmentHeights] = useState<string[]>([])
  const [dragTarget, setDragTarget] = useState<{ kind: 'calib' | 'vertex'; index: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const traceFileInputRef = useRef<HTMLInputElement | null>(null)

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
      } else if (scaffoldPlan.input_mode === 'perimeter') {
        const per = byLabel('perimeter')
        setPerimeterInput(per ? String(per.length_m) : '')
        setHeight(per ? String(per.height_m) : '')
      } else {
        setTraceImageUrl(scaffoldPlan.image_url)
        setScaleMPerPx(scaffoldPlan.scale_m_per_px)
        const pts = segments.map(s => ({ x: Number(s.vertex_x_px) || 0, y: Number(s.vertex_y_px) || 0 }))
        setVertices(pts)
        setPolygonClosed(pts.length >= 3)
        setSegmentHeights(segments.map(s => String(s.height_m)))
        setTraceSubMode('trace')
      }
    }
    setLoading(false)
  }

  async function save() {
    if (mode === 'trace' && (!polygonClosed || !scaleMPerPx)) {
      alert('スケール校正と頂点の確定（閉じる）を行ってから保存してください')
      return
    }

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
          image_url: mode === 'trace' ? traceImageUrl : null,
          scale_m_per_px: mode === 'trace' ? scaleMPerPx : null,
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
            { label: 'east', length_m: Number(east) || 0, height_m: Number(eastHeight) || 0, vertex_x_px: null, vertex_y_px: null },
            { label: 'west', length_m: Number(west) || 0, height_m: Number(westHeight) || 0, vertex_x_px: null, vertex_y_px: null },
            { label: 'south', length_m: Number(south) || 0, height_m: Number(southHeight) || 0, vertex_x_px: null, vertex_y_px: null },
            { label: 'north', length_m: Number(north) || 0, height_m: Number(northHeight) || 0, vertex_x_px: null, vertex_y_px: null },
          ]
        : mode === 'rect'
        ? [
            { label: 'depth', length_m: Number(depth) || 0, height_m: h, vertex_x_px: null, vertex_y_px: null },
            { label: 'width', length_m: Number(width) || 0, height_m: h, vertex_x_px: null, vertex_y_px: null },
          ]
        : mode === 'perimeter'
        ? [{ label: 'perimeter', length_m: Number(perimeterInput) || 0, height_m: h, vertex_x_px: null, vertex_y_px: null }]
        : vertices.map((v, i) => ({
            label: `seg${i}`,
            length_m: scaleMPerPx ? dist(v, vertices[(i + 1) % vertices.length]) * scaleMPerPx : 0,
            height_m: Number(segmentHeights[i]) || 0,
            vertex_x_px: v.x,
            vertex_y_px: v.y,
          }))

    await supabase.from('scaffold_segments').delete().eq('plan_id', savedPlanId)
    await supabase.from('scaffold_segments').insert(
      segmentsToSave.map((seg, i) => ({ plan_id: savedPlanId, order_index: i, ...seg })),
    )

    setSaving(false)
    setSuccess('保存しました')
    setTimeout(() => setSuccess(''), 2000)
  }

  // 図面トレース: 画像上のクリック位置を、画像の元サイズ基準のpx座標に変換する
  function pointFromClientXY(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current
    if (!svg || !naturalSize) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = ((clientX - rect.left) / rect.width) * naturalSize.w
    const y = ((clientY - rect.top) / rect.height) * naturalSize.h
    return {
      x: Math.max(0, Math.min(naturalSize.w, x)),
      y: Math.max(0, Math.min(naturalSize.h, y)),
    }
  }

  function handleTraceClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!traceImageUrl || !naturalSize) return
    const pt = pointFromClientXY(e.clientX, e.clientY)
    if (!pt) return
    if (traceSubMode === 'calibrate') {
      if (calibPoints.length >= 2) return
      setCalibPoints(cp => [...cp, pt])
    } else {
      if (polygonClosed) return
      setVertices(vs => [...vs, pt])
    }
  }

  function handlePointDown(kind: 'calib' | 'vertex', index: number, e: React.PointerEvent) {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragTarget({ kind, index })
  }

  function handleSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragTarget) return
    const pt = pointFromClientXY(e.clientX, e.clientY)
    if (!pt) return
    if (dragTarget.kind === 'calib') {
      setCalibPoints(cp => cp.map((p, i) => (i === dragTarget.index ? pt : p)))
    } else {
      setVertices(vs => vs.map((p, i) => (i === dragTarget.index ? pt : p)))
    }
  }

  function handleSvgPointerUp() {
    setDragTarget(null)
  }

  function confirmCalibration() {
    if (calibPoints.length !== 2) return
    const lenM = Number(calibLengthInput)
    const pxDist = dist(calibPoints[0], calibPoints[1])
    if (!lenM || lenM <= 0 || pxDist <= 0) {
      alert('実測した実寸（m）を正しく入力してください')
      return
    }
    setScaleMPerPx(lenM / pxDist)
    setTraceSubMode('trace')
  }

  function resetCalibration() {
    setCalibPoints([])
    setCalibLengthInput('')
    setScaleMPerPx(null)
    setTraceSubMode('calibrate')
  }

  function undoVertex() {
    if (!polygonClosed) setVertices(vs => vs.slice(0, -1))
  }

  function clearVertices() {
    setVertices([])
    setPolygonClosed(false)
    setSegmentHeights([])
  }

  function closePolygon() {
    if (vertices.length < 3) {
      alert('頂点を3つ以上入力してください')
      return
    }
    setPolygonClosed(true)
    setSegmentHeights(vertices.map((_, i) => segmentHeights[i] ?? ''))
  }

  function resetTraceImage() {
    setTraceImageUrl(null)
    setNaturalSize(null)
    setCalibPoints([])
    setCalibLengthInput('')
    setScaleMPerPx(null)
    setVertices([])
    setPolygonClosed(false)
    setSegmentHeights([])
    setTraceSubMode('calibrate')
  }

  async function handleTraceImageUpload(file: File) {
    setUploadingImage(true)
    try {
      const blob = await resizeImageToBlob(file)
      const path = `scaffold/${id}/plan-${Date.now()}.jpg`
      await supabase.storage.from('project-files').upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
      const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
      resetTraceImage()
      setTraceImageUrl(urlData.publicUrl)
    } catch {
      alert('画像のアップロードに失敗しました')
    }
    setUploadingImage(false)
    if (traceFileInputRef.current) traceFileInputRef.current.value = ''
  }

  const perimeter =
    mode === 'directions' ? (Number(east) || 0) + (Number(west) || 0) + (Number(south) || 0) + (Number(north) || 0) :
    mode === 'rect' ? (Number(depth) || 0) * 2 + (Number(width) || 0) * 2 :
    mode === 'perimeter' ? Number(perimeterInput) || 0 :
    0

  const traceSides: Side[] = polygonClosed && scaleMPerPx
    ? vertices.map((v, i) => ({
        label: `区間${i + 1}`,
        length: dist(v, vertices[(i + 1) % vertices.length]) * scaleMPerPx,
        height: Number(segmentHeights[i]) || 0,
      }))
    : []

  // 東西南北個別入力・図面トレースの場合は、辺（区間）ごとに長さ・高さが違う前提でスパン数・段数を計算する。
  // それ以外のモードは建物全体を1つの辺として扱い、これまでと同じ計算結果になる
  const sides: Side[] =
    mode === 'directions'
      ? [
          { label: '東', length: Number(east) || 0, height: Number(eastHeight) || 0 },
          { label: '西', length: Number(west) || 0, height: Number(westHeight) || 0 },
          { label: '南', length: Number(south) || 0, height: Number(southHeight) || 0 },
          { label: '北', length: Number(north) || 0, height: Number(northHeight) || 0 },
        ]
      : mode === 'trace'
      ? traceSides
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
          <div className="grid grid-cols-2 gap-2">
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
            <button type="button" onClick={() => setMode('trace')}
              className={`py-2 rounded border text-sm font-medium ${mode === 'trace' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              図面トレース
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
        ) : mode === 'perimeter' ? (
          <div>
            <label className="block text-sm font-medium mb-1">周囲長（m）</label>
            <input type="number" inputMode="decimal" step="0.1" className={inputClass} value={perimeterInput}
              onChange={e => setPerimeterInput(e.target.value)} placeholder="0" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!traceImageUrl ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-gray-500">図面（上空図面・平面図など）の写真を用意してください。</p>
                {project?.aerial_photo_url && (
                  <button type="button" onClick={() => setTraceImageUrl(project.aerial_photo_url)}
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
                    現場の上空図面を使う
                  </button>
                )}
                <button type="button" onClick={() => traceFileInputRef.current?.click()} disabled={uploadingImage}
                  className="border border-blue-600 text-blue-600 px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
                  {uploadingImage ? 'アップロード中...' : '図面画像をアップロード'}
                </button>
                <input ref={traceFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleTraceImageUpload(f) }} />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-gray-700">
                    {traceSubMode === 'calibrate' ? '① スケール校正' : '② 建物の輪郭をなぞる'}
                  </p>
                  <button type="button" onClick={resetTraceImage} className="text-xs text-gray-400">画像を変更</button>
                </div>

                <div className="relative border rounded overflow-hidden" style={{ touchAction: 'none' }}>
                  <img src={traceImageUrl} alt="図面" draggable={false} className="w-full h-auto block select-none"
                    onLoad={e => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
                  {naturalSize && (
                    <svg ref={svgRef} viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`} preserveAspectRatio="none"
                      className="absolute inset-0 w-full h-full"
                      onClick={handleTraceClick} onPointerMove={handleSvgPointerMove} onPointerUp={handleSvgPointerUp}>
                      {calibPoints.length === 2 && (
                        <line x1={calibPoints[0].x} y1={calibPoints[0].y} x2={calibPoints[1].x} y2={calibPoints[1].y}
                          stroke="#dc2626" strokeWidth={naturalSize.w / 250} />
                      )}
                      {calibPoints.map((p, i) => (
                        <circle key={`c${i}`} cx={p.x} cy={p.y} r={naturalSize.w / 100} fill="#dc2626" stroke="white"
                          strokeWidth={naturalSize.w / 500}
                          onPointerDown={e => handlePointDown('calib', i, e)}
                          onClick={e => e.stopPropagation()} />
                      ))}
                      {vertices.length >= 2 && (
                        <polyline
                          points={[...vertices, ...(polygonClosed ? [vertices[0]] : [])].map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none" stroke="#2563eb" strokeWidth={naturalSize.w / 300} />
                      )}
                      {vertices.map((p, i) => (
                        <circle key={`v${i}`} cx={p.x} cy={p.y} r={naturalSize.w / 130} fill="#2563eb" stroke="white"
                          strokeWidth={naturalSize.w / 500}
                          onPointerDown={e => handlePointDown('vertex', i, e)}
                          onClick={e => e.stopPropagation()} />
                      ))}
                    </svg>
                  )}
                </div>

                {traceSubMode === 'calibrate' ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-500">
                      現場でメジャー実測できる辺（外壁の1辺など）の両端を図面上でタップしてください（{calibPoints.length}/2点）。
                      打った点はドラッグで位置を微調整できます。
                    </p>
                    {calibPoints.length === 2 && (
                      <div className="flex items-center gap-2">
                        <input type="number" inputMode="decimal" step="0.1" className={inputClass}
                          value={calibLengthInput} onChange={e => setCalibLengthInput(e.target.value)}
                          placeholder="実測した長さ（m）" />
                        <button type="button" onClick={confirmCalibration}
                          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0">
                          校正を確定
                        </button>
                      </div>
                    )}
                    {calibPoints.length > 0 && (
                      <button type="button" onClick={resetCalibration} className="text-xs text-gray-400 text-left">やり直す</button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-500">
                      スケール: 1pxあたり{(scaleMPerPx ?? 0).toFixed(4)}m。建物の角を順にタップして輪郭をなぞってください（{vertices.length}点）。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setTraceSubMode('calibrate')}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-600">スケールを再校正</button>
                      <button type="button" onClick={undoVertex} disabled={vertices.length === 0 || polygonClosed}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-600 disabled:opacity-40">元に戻す</button>
                      <button type="button" onClick={clearVertices} disabled={vertices.length === 0}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-600 disabled:opacity-40">クリア</button>
                      {!polygonClosed && vertices.length >= 3 && (
                        <button type="button" onClick={closePolygon}
                          className="text-xs px-3 py-1 rounded bg-blue-600 text-white font-medium">頂点を確定（閉じる）</button>
                      )}
                      {polygonClosed && (
                        <button type="button" onClick={() => setPolygonClosed(false)}
                          className="text-xs px-3 py-1 rounded border border-blue-600 text-blue-600">頂点を編集</button>
                      )}
                    </div>
                  </div>
                )}

                {polygonClosed && (
                  <div className="flex flex-col gap-3 mt-1">
                    <p className="text-sm font-medium text-gray-700">区間ごとの高さ</p>
                    {traceSides.map((s, i) => (
                      <div key={i} className="border rounded p-3">
                        <p className="text-sm font-medium mb-2">{s.label}（{s.length.toFixed(1)}m）</p>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">高さ（m）</label>
                          <input type="number" inputMode="decimal" step="0.1" className={inputClass}
                            value={segmentHeights[i] ?? ''}
                            onChange={e => setSegmentHeights(hs => hs.map((v, j) => j === i ? e.target.value : v))}
                            placeholder="0" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode !== 'directions' && mode !== 'trace' && perimeter > 0 && (
          <p className="text-sm text-gray-500">周囲長: <span className="font-medium text-gray-800">{perimeter.toFixed(1)}m</span></p>
        )}

        {(mode === 'rect' || mode === 'perimeter') && (
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
          <p className="text-gray-400 text-sm text-center py-2">
            {mode === 'trace' ? '図面トレースで頂点を確定し、高さを入力してください' : '寸法・高さを入力してください'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {(mode === 'directions' || mode === 'trace') && (
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
          {mode === 'directions' || mode === 'trace'
            ? '辺（区間）ごとに、長さ÷スパン間隔・高さ÷段の高さを切り上げてから計算し、最後に合計しています。'
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
