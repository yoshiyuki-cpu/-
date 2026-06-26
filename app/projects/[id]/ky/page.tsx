'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase, KyPhoto } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

const today = new Date().toISOString().split('T')[0]

export default function KyPage() {
  const { id } = useParams()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<KyPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadDate, setUploadDate] = useState(today)
  const [enlarged, setEnlarged] = useState<KyPhoto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<KyPhoto | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('ky_photos')
      .select('*')
      .eq('project_id', id)
      .order('date', { ascending: false })
    setPhotos(data ?? [])
    setLoading(false)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    const ext = file.name.split('.').pop()
    const path = `ky/${id}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('project-files')
      .upload(path, file, { cacheControl: '3600', upsert: false })

    if (uploadError) {
      alert('アップロードに失敗しました: ' + uploadError.message)
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)

    await supabase.from('ky_photos').insert({
      project_id: Number(id),
      date: uploadDate,
      photo_url: urlData.publicUrl,
    })

    await load()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    // Storage上のファイルを削除
    const path = deleteTarget.photo_url.split('/project-files/')[1]
    if (path) await supabase.storage.from('project-files').remove([path])
    await supabase.from('ky_photos').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    setDeleting(false)
    setEnlarged(null)
    await load()
  }

  return (
    <div>
      {/* 拡大表示モーダル */}
      {enlarged && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setEnlarged(null)}>
          <div className="flex justify-between items-center px-4 py-3" onClick={e => e.stopPropagation()}>
            <p className="text-white font-medium">{enlarged.date}</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteTarget(enlarged) }}
                className="text-red-400 text-sm border border-red-400 px-3 py-1 rounded">
                削除
              </button>
              <button onClick={() => setEnlarged(null)} className="text-white text-2xl leading-none">✕</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4" onClick={() => setEnlarged(null)}>
            <img src={enlarged.photo_url} alt={enlarged.date}
              className="max-w-full max-h-full object-contain rounded" />
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">削除の確認</h3>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.date} のKY写真を削除しますか？<br />この操作は元に戻せません。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border rounded-lg text-gray-600">キャンセル</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3 py-1">← 現場詳細</button>
      <h1 className="text-xl font-bold mb-4">KY活動</h1>

      {/* アップロードエリア */}
      <div className="bg-white rounded-lg shadow p-4 mb-5">
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">日付</label>
          <input type="date" className="w-full border rounded px-3 py-3"
            value={uploadDate} onChange={e => setUploadDate(e.target.value)} />
        </div>
        <label className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg py-6 cursor-pointer transition
          ${uploading ? 'border-gray-200 bg-gray-50' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}`}>
          {uploading ? (
            <div className="text-center">
              <div className="text-2xl mb-1">⏳</div>
              <p className="text-sm text-gray-500">アップロード中...</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-3xl mb-1">📷</div>
              <p className="text-sm font-medium text-blue-700">タップして写真を撮影・選択</p>
              <p className="text-xs text-gray-400 mt-1">KY用紙を撮影してください</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploading}
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {/* 写真一覧 */}
      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && photos.length === 0 && (
        <p className="text-gray-400 text-center py-10">写真がありません</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {photos.map(p => (
          <button key={p.id} onClick={() => setEnlarged(p)}
            className="bg-white rounded-lg shadow overflow-hidden text-left">
            <img src={p.photo_url} alt={p.date}
              className="w-full aspect-[4/3] object-cover" />
            <p className="text-xs text-gray-600 px-2 py-1.5 font-medium">{p.date}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
