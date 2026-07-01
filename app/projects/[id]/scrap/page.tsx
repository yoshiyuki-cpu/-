'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase, ScrapRecord } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

const today = new Date().toISOString().split('T')[0]

type ScrapItem = { name: string; amount: number }

export default function ScrapPage() {
  const { id } = useParams()
  const router = useRouter()
  const sitePhotoRef = useRef<HTMLInputElement>(null)
  const slipPhotoRef = useRef<HTMLInputElement>(null)

  const [records, setRecords] = useState<ScrapRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScrapRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // フォーム
  const [date, setDate] = useState(today)
  const [items, setItems] = useState<ScrapItem[]>([])
  const [manualItem, setManualItem] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [note, setNote] = useState('')
  const [sitePhotoUrl, setSitePhotoUrl] = useState<string | null>(null)
  const [slipPhotoUrl, setSlipPhotoUrl] = useState<string | null>(null)
  const [uploadingSite, setUploadingSite] = useState(false)
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const [analyzingSlip, setAnalyzingSlip] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('scrap_records')
      .select('*')
      .eq('project_id', id)
      .order('date', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  function resetForm() {
    setDate(today)
    setItems([])
    setManualItem('')
    setTotalAmount('')
    setNote('')
    setSitePhotoUrl(null)
    setSlipPhotoUrl(null)
    if (sitePhotoRef.current) sitePhotoRef.current.value = ''
    if (slipPhotoRef.current) slipPhotoRef.current.value = ''
  }

  // 現物写真アップロード
  async function handleSitePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSite(true)
    const ext = file.name.split('.').pop()
    const path = `scrap/${id}/site_${Date.now()}.${ext}`
    await supabase.storage.from('project-files').upload(path, file, { upsert: false })
    const { data } = supabase.storage.from('project-files').getPublicUrl(path)
    setSitePhotoUrl(data.publicUrl)
    setUploadingSite(false)
  }

  // 伝票写真アップロード＋AI読み取り
  async function handleSlipPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSlip(true)

    // まず写真をStorageに保存
    const ext = file.name.split('.').pop()
    const path = `scrap/${id}/slip_${Date.now()}.${ext}`
    await supabase.storage.from('project-files').upload(path, file, { upsert: false })
    const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
    setSlipPhotoUrl(urlData.publicUrl)
    setUploadingSlip(false)

    // AI読み取り
    setAnalyzingSlip(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(',')[1]
      const res = await fetch('/api/analyze-scrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      })
      const json = await res.json()
      if (json.items && json.items.length > 0) {
        setItems(json.items.filter((i: any) => i.name && i.amount))
      }
      if (json.total) {
        setTotalAmount(String(json.total))
      }
      setAnalyzingSlip(false)
    }
    reader.readAsDataURL(file)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!totalAmount) return
    setSaving(true)
    await supabase.from('scrap_records').insert({
      project_id: Number(id),
      date,
      items: items.length > 0 ? JSON.stringify(items) : (manualItem || null),
      amount: Number(totalAmount),
      note: note || null,
      site_photo_url: sitePhotoUrl,
      slip_photo_url: slipPhotoUrl,
    })
    setSaving(false)
    setSuccess(true)
    resetForm()
    await load()
    setTimeout(() => { setSuccess(false); setShowForm(false) }, 1500)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    // Storage写真削除
    for (const url of [deleteTarget.site_photo_url, deleteTarget.slip_photo_url]) {
      if (url) {
        const path = url.split('/project-files/')[1]
        if (path) await supabase.storage.from('project-files').remove([path])
      }
    }
    await supabase.from('scrap_records').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    setDeleting(false)
    load()
  }

  const totalRevenue = records.reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div>
      {/* 写真拡大モーダル */}
      {enlarged && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setEnlarged(null)}>
          <div className="flex justify-end px-4 py-3">
            <button onClick={() => setEnlarged(null)} className="text-white text-2xl">✕</button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img src={enlarged} alt="" className="max-w-full max-h-full object-contain rounded" />
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">削除の確認</h3>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.date} のスクラップ記録を削除しますか？<br />写真も削除されます。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 border rounded-lg text-gray-600">キャンセル</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3 py-1">← 現場詳細</button>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold">スクラップ記録</h1>
          <p className="text-sm text-blue-600 font-medium mt-0.5">収益合計：{totalRevenue.toLocaleString()}円</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(v => !v) }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
          {showForm ? '閉じる' : '+ 新規記録'}
        </button>
      </div>

      {/* 入力フォーム */}
      {showForm && (
        <form onSubmit={save} className="bg-white rounded-lg shadow p-4 mb-5 flex flex-col gap-4">
          {success && <div className="bg-green-100 text-green-700 rounded px-3 py-2 text-sm">保存しました ✓</div>}

          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border rounded px-3 py-3"
              value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {/* ① 現物写真 */}
          <div>
            <label className="block text-sm font-medium mb-2">① 現物写真（捨てる前）</label>
            {sitePhotoUrl ? (
              <div className="relative">
                <img src={sitePhotoUrl} alt="現物写真"
                  className="w-full rounded-lg border object-cover max-h-48 cursor-pointer"
                  onClick={() => setEnlarged(sitePhotoUrl)} />
                <button type="button"
                  onClick={() => { setSitePhotoUrl(null); if (sitePhotoRef.current) sitePhotoRef.current.value = '' }}
                  className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm">✕</button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg py-5 cursor-pointer transition
                ${uploadingSite ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}>
                {uploadingSite ? (
                  <p className="text-sm text-gray-400">アップロード中...</p>
                ) : (
                  <>
                    <span className="text-2xl mb-1">📷</span>
                    <p className="text-sm text-gray-500">現物を撮影</p>
                  </>
                )}
                <input ref={sitePhotoRef} type="file" accept="image/*"
                  className="hidden" disabled={uploadingSite} onChange={handleSitePhoto} />
              </label>
            )}
          </div>

          {/* ② 伝票写真 */}
          <div>
            <label className="block text-sm font-medium mb-2">② 伝票写真（AI読み取り）</label>
            {slipPhotoUrl ? (
              <div className="relative">
                <img src={slipPhotoUrl} alt="伝票写真"
                  className="w-full rounded-lg border object-cover max-h-48 cursor-pointer"
                  onClick={() => setEnlarged(slipPhotoUrl)} />
                <button type="button"
                  onClick={() => { setSlipPhotoUrl(null); setItems([]); setTotalAmount(''); if (slipPhotoRef.current) slipPhotoRef.current.value = '' }}
                  className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm">✕</button>
                {analyzingSlip && (
                  <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                    <p className="text-white text-sm font-medium">AI読み取り中...</p>
                  </div>
                )}
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg py-5 cursor-pointer transition
                ${uploadingSlip || analyzingSlip ? 'border-blue-200 bg-blue-50' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}`}>
                {uploadingSlip ? (
                  <p className="text-sm text-blue-400">アップロード中...</p>
                ) : analyzingSlip ? (
                  <p className="text-sm text-blue-600 font-medium">AI読み取り中...</p>
                ) : (
                  <>
                    <span className="text-2xl mb-1">🧾</span>
                    <p className="text-sm font-medium text-blue-700">伝票を撮影してAI読み取り</p>
                  </>
                )}
                <input ref={slipPhotoRef} type="file" accept="image/*"
                  className="hidden" disabled={uploadingSlip || analyzingSlip} onChange={handleSlipPhoto} />
              </label>
            )}
          </div>

          {/* AI読み取り結果 */}
          {items.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium mb-2">AI読み取り結果（修正可）</p>
              <div className="flex flex-col gap-1">
                {items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className="flex-1 border rounded px-2 py-1.5 text-sm bg-white"
                      value={item.name}
                      onChange={e => setItems(items.map((it, j) => j === i ? { ...it, name: e.target.value } : it))} />
                    <input type="number" className="w-28 border rounded px-2 py-1.5 text-sm bg-white"
                      value={item.amount}
                      onChange={e => setItems(items.map((it, j) => j === i ? { ...it, amount: Number(e.target.value) } : it))} />
                    <span className="text-xs text-gray-500">円</span>
                    <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                      className="text-gray-300 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 品目手入力（AI未使用の場合） */}
          {items.length === 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">品目（手入力）</label>
              <input className="w-full border rounded px-3 py-3 text-sm"
                value={manualItem}
                onChange={e => setManualItem(e.target.value)}
                placeholder="例：鉄スクラップ、アルミ" />
            </div>
          )}

          {/* 合計金額 */}
          <div>
            <label className="block text-sm font-medium mb-1">合計金額（円）</label>
            <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-3 text-base"
              value={totalAmount}
              onChange={e => setTotalAmount(e.target.value)}
              placeholder="0" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">メモ（任意）</label>
            <input className="w-full border rounded px-3 py-3 text-sm"
              value={note} onChange={e => setNote(e.target.value)} placeholder="" />
          </div>

          <button type="submit" disabled={saving || !totalAmount}
            className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50 text-base">
            {saving ? '保存中...' : '保存する'}
          </button>
        </form>
      )}

      {/* 記録一覧 */}
      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && records.length === 0 && (
        <p className="text-gray-400 text-center py-10">記録がありません</p>
      )}

      <div className="flex flex-col gap-3">
        {records.map(r => {
          const parsedItems: ScrapItem[] = (() => {
            try { return r.items ? JSON.parse(r.items) : [] } catch { return [] }
          })()
          const itemLabel = parsedItems.length > 0
            ? parsedItems.map(i => i.name).join('・')
            : (r.items ?? '')

          return (
            <div key={r.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-bold text-gray-800">{r.date}</p>
                  {itemLabel && <p className="text-sm text-gray-600 mt-0.5">{itemLabel}</p>}
                  {r.note && <p className="text-xs text-gray-400 mt-0.5">{r.note}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold text-blue-600">{Number(r.amount).toLocaleString()}円</p>
                  <button onClick={() => setDeleteTarget(r)}
                    className="text-gray-300 hover:text-red-400 text-lg px-1">✕</button>
                </div>
              </div>

              {/* 写真サムネイル */}
              {(r.site_photo_url || r.slip_photo_url) && (
                <div className="flex gap-2">
                  {r.site_photo_url && (
                    <button onClick={() => setEnlarged(r.site_photo_url!)}
                      className="flex-1 relative">
                      <img src={r.site_photo_url} alt="現物"
                        className="w-full h-24 object-cover rounded border" />
                      <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1 rounded">現物</span>
                    </button>
                  )}
                  {r.slip_photo_url && (
                    <button onClick={() => setEnlarged(r.slip_photo_url!)}
                      className="flex-1 relative">
                      <img src={r.slip_photo_url} alt="伝票"
                        className="w-full h-24 object-cover rounded border" />
                      <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1 rounded">伝票</span>
                    </button>
                  )}
                </div>
              )}

              {/* 品目内訳 */}
              {parsedItems.length > 1 && (
                <div className="mt-2 pt-2 border-t">
                  {parsedItems.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-gray-600">
                      <span>{item.name}</span>
                      <span>{item.amount.toLocaleString()}円</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
