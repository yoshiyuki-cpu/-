'use client'
import { useMemo, useRef, useState } from 'react'
import {
  TILE_KINDS, codeToTile, tilesToCounts, tileLabel, tileSuit,
  isAgari, calcShanten, calcWaits, calcDiscardOptions,
} from '@/lib/mahjong'

const SUIT_ROWS: { label: string; tiles: number[] }[] = [
  { label: '萬子', tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  { label: '筒子', tiles: [9, 10, 11, 12, 13, 14, 15, 16, 17] },
  { label: '索子', tiles: [18, 19, 20, 21, 22, 23, 24, 25, 26] },
  { label: '字牌', tiles: [27, 28, 29, 30, 31, 32, 33] },
]

function tileColor(t: number): string {
  const suit = tileSuit(t)
  if (suit === 'm') return 'text-red-700'
  if (suit === 'p') return 'text-blue-700'
  if (suit === 's') return 'text-green-700'
  if (t === 32) return 'text-green-700' // 發
  if (t === 33) return 'text-red-600' // 中
  return 'text-gray-800'
}

function TileFace({ tile, size = 'md' }: { tile: number; size?: 'sm' | 'md' }) {
  const { main, sub } = tileLabel(tile)
  const dims = size === 'sm' ? 'w-8 h-11 text-sm' : 'w-10 h-14 text-lg'
  return (
    <span className={`${dims} inline-flex flex-col items-center justify-center rounded-md bg-white border border-gray-300 shadow-sm font-bold leading-none select-none ${tileColor(tile)}`}>
      <span>{main}</span>
      {sub && <span className="text-[10px] mt-0.5">{sub}</span>}
    </span>
  )
}

// 画像を縮小してJPEGのbase64に変換（通信量と解析コストを抑える）
async function compressImage(file: File): Promise<{ data: string; mediaType: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('画像を読み込めませんでした'))
      el.src = url
    })
    const maxSide = 1568
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function MahjongPage() {
  const [hand, setHand] = useState<number[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromPhoto, setFromPhoto] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => tilesToCounts(hand), [hand])

  const result = useMemo(() => {
    const n = hand.length
    if (n === 0) return null
    if (n % 3 === 1) {
      // ツモ前の形（13枚、副露があれば10・7・4枚）→ 待ちを判定
      const waits = calcWaits(counts)
      if (waits.length > 0) return { type: 'tenpai' as const, waits }
      return { type: 'noten' as const, shanten: n === 13 ? calcShanten(counts) : null }
    }
    if (n % 3 === 2) {
      // ツモ後の形（14枚など）→ 何を切れば何待ちか
      if (isAgari(counts)) return { type: 'agari' as const }
      const options = calcDiscardOptions(counts)
      if (options.length > 0) return { type: 'discard' as const, options }
      return { type: 'noten' as const, shanten: null }
    }
    return { type: 'incomplete' as const }
  }, [hand, counts])

  function addTile(t: number) {
    if (hand.length >= 14 || counts[t] >= 4) return
    setHand(prev => [...prev, t].sort((a, b) => a - b))
  }

  function removeTileAt(index: number) {
    setHand(prev => prev.filter((_, i) => i !== index))
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAnalyzing(true)
    setError(null)
    try {
      const { data, mediaType } = await compressImage(file)
      const res = await fetch('/api/analyze-mahjong', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: data, mediaType }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '解析に失敗しました')
      const tiles: number[] = []
      const c = new Array(TILE_KINDS).fill(0)
      for (const code of json.tiles as string[]) {
        const t = codeToTile(code)
        if (t !== null && c[t] < 4 && tiles.length < 14) {
          c[t]++
          tiles.push(t)
        }
      }
      if (tiles.length === 0) {
        setError('牌を読み取れませんでした。明るい場所で牌を正面から撮影してください。')
      } else {
        setHand(tiles.sort((a, b) => a - b))
        setFromPhoto(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析に失敗しました')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">🀄 麻雀 待ち判定</h1>
        <p className="text-sm text-gray-500 mt-1">手牌を撮影するか、牌を選んで入力すると待ち牌がわかります</p>
      </div>

      {/* 撮影・選択ボタン */}
      <div className="grid grid-cols-2 gap-3">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
        <button onClick={() => cameraRef.current?.click()} disabled={analyzing}
          className="rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 text-white font-semibold py-4 shadow-md active:scale-[0.98] transition disabled:opacity-50">
          📷 手牌を撮影
        </button>
        <button onClick={() => galleryRef.current?.click()} disabled={analyzing}
          className="rounded-2xl bg-white border border-gray-200 text-gray-700 font-semibold py-4 shadow-sm active:scale-[0.98] transition disabled:opacity-50">
          🖼 写真から選ぶ
        </button>
      </div>

      {analyzing && (
        <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-700 animate-pulse">
          🔍 AIが牌を読み取っています...
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {fromPhoto && !analyzing && hand.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
          ⚠️ 読み取り結果を確認してください。間違っている牌はタップで消して、下の牌一覧から追加できます。
        </div>
      )}

      {/* 手牌 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">手牌 <span className="text-gray-400 font-normal">{hand.length}枚（タップで削除）</span></h2>
          {hand.length > 0 && (
            <button onClick={() => { setHand([]); setFromPhoto(false); setError(null) }} className="text-xs text-red-500 border border-red-200 rounded-full px-3 py-1">全消去</button>
          )}
        </div>
        {hand.length === 0 ? (
          <p className="text-sm text-gray-400 py-3 text-center">まだ牌がありません</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {hand.map((t, i) => (
              <button key={i} onClick={() => removeTileAt(i)} className="active:scale-95 transition">
                <TileFace tile={t} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 判定結果 */}
      {result && (
        <section className="rounded-2xl border shadow-sm p-4 space-y-3 bg-white border-gray-100">
          {result.type === 'agari' && (
            <p className="text-lg font-bold text-rose-600">🎉 和了（あがり）の形です！</p>
          )}

          {result.type === 'tenpai' && (
            <>
              <p className="font-bold text-emerald-700">✅ 聴牌！ 待ちは {result.waits.length} 種 {result.waits.reduce((s, w) => s + w.remaining, 0)} 枚</p>
              <div className="flex flex-wrap gap-3">
                {result.waits.map(w => (
                  <div key={w.tile} className="flex flex-col items-center gap-1">
                    <TileFace tile={w.tile} />
                    <span className="text-[11px] text-gray-500">残り{w.remaining}枚</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">※残り枚数は自分の手牌から見えていない枚数です（他家の手牌・捨て牌は含みません）</p>
            </>
          )}

          {result.type === 'discard' && (
            <>
              <p className="font-bold text-emerald-700">✅ 聴牌！ 切る牌ごとの待ち（枚数が多い順）</p>
              <div className="space-y-3">
                {result.options.map(opt => (
                  <div key={opt.discard} className="flex items-start gap-3 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className="text-[11px] text-gray-500">切る</span>
                      <TileFace tile={opt.discard} />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 mb-1">待ち {opt.waits.length}種 {opt.totalRemaining}枚</p>
                      <div className="flex flex-wrap gap-1">
                        {opt.waits.map(w => <TileFace key={w.tile} tile={w.tile} size="sm" />)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {result.type === 'noten' && (
            <p className="font-semibold text-gray-600">
              ❌ 聴牌していません
              {result.shanten !== null && result.shanten >= 1 && <span className="text-sm font-normal text-gray-500">（{result.shanten}向聴）</span>}
            </p>
          )}

          {result.type === 'incomplete' && (
            <p className="text-sm text-gray-500">
              待ちを判定するには、ツモ前なら13枚・ツモ後なら14枚にしてください（ポン・チー・カンした分は除いて、手元の牌だけ入力してください）
            </p>
          )}
        </section>
      )}

      {/* 牌の手入力 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">牌を追加</h2>
        {SUIT_ROWS.map(row => (
          <div key={row.label}>
            <p className="text-[11px] text-gray-400 mb-1">{row.label}</p>
            <div className="flex flex-wrap gap-1">
              {row.tiles.map(t => {
                const disabled = counts[t] >= 4 || hand.length >= 14
                return (
                  <button key={t} onClick={() => addTile(t)} disabled={disabled}
                    className={`transition ${disabled ? 'opacity-30' : 'active:scale-95'}`}>
                    <TileFace tile={t} size="sm" />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-gray-400">
          ポン・チー・カンしている場合は、その分を除いた手元の牌だけ入力してください（10枚・7枚・4枚でも判定できます）
        </p>
      </section>
    </div>
  )
}
