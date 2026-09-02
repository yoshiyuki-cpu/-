'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase, PipeDiagram } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import { jstToday } from '@/lib/date'

// よく使う種別。押すとメモ欄に入る（自由入力もできる）
const KIND_PRESETS = ['水道', 'ガス', '下水', '電気', '雨水', '浄化槽']

export default function PipeDiagramPage() {
  const { id } = useParams()
  const router = useRouter()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<PipeDiagram[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [date, setDate] = useState(jstToday())
  const [note, setNote] = useState('')
  const [enlarged, setEnlarged] = useState<PipeDiagram | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PipeDiagram | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<{ id: number; note: string } | null>(null)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pipe_diagrams')
      .select('*')
      .eq('project_id', id)
      .order('date', { ascending: false })
    // テーブルがまだ無い環境では、壊れた見た目ではなく次にやる事を出す
    if (error) setNeedsSetup(true)
    setItems(data ?? [])
    setLoading(false)
  }

  function clearInputs() {
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (albumInputRef.current) albumInputRef.current.value = ''
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploading(files.length > 1 ? `${i + 1}/${files.length}枚` : '')

      // アルバムから選んだ写真は拡張子が付かない事もあるので、無い時はjpgとして扱う
      const dot = file.name.lastIndexOf('.')
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'jpg'
      const path = `pipes/${id}/${Date.now()}-${i}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(path, file, { cacheControl: '3600', upsert: false })

      if (uploadError) {
        alert('アップロードに失敗しました: ' + uploadError.message)
        setUploading(null)
        clearInputs()
        return
      }

      const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
      const { error: insertError } = await supabase.from('pipe_diagrams').insert({
        project_id: Number(id),
        date,
        photo_url: urlData.publicUrl,
        note: note.trim() || null,
      })
      if (insertError) {
        alert(insertError.message.includes('pipe_diagrams')
          ? '管路図の準備がまだです。Supabaseで supabase-schema-pipe-diagrams.sql を実行してください。'
          : '登録に失敗しました。')
        setUploading(null)
        clearInputs()
        return
      }
    }

    setUploading(null)
    clearInputs()
    await load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const path = deleteTarget.photo_url.split('/project-files/')[1]
    if (path) await supabase.storage.from('project-files').remove([path])
    await supabase.from('pipe_diagrams').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    setDeleting(false)
    setEnlarged(null)
    await load()
  }

  async function saveNote() {
    if (!editing) return
    const { error } = await supabase.from('pipe_diagrams')
      .update({ note: editing.note.trim() || null }).eq('id', editing.id)
    if (error) { alert('メモを保存できませんでした。'); return }
    setEditing(null)
    await load()
  }

  return (
    <div>
      {/* 拡大表示 */}
      {enlarged && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setEnlarged(null)}>
          <div className="flex justify-between items-center px-4 py-3" onClick={e => e.stopPropagation()}>
            <p className="text-white font-medium text-sm">
              {enlarged.date}{enlarged.note ? `　${enlarged.note}` : ''}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(enlarged)}
                className="text-red-400 text-sm border border-red-400 px-3 py-1 rounded">削除</button>
              <button onClick={() => setEnlarged(null)} className="text-white text-2xl leading-none">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2" onClick={() => setEnlarged(null)}>
            {/* 図面は細かいので、拡大表示では画面幅に合わせつつ縦にスクロールできるようにする */}
            <img src={enlarged.photo_url} alt={enlarged.note ?? enlarged.date}
              className="w-full h-auto rounded" onClick={e => e.stopPropagation()} />
          </div>
          <p className="text-white/60 text-xs text-center pb-3">画像を指で広げると拡大できます</p>
        </div>
      )}

      {/* 削除確認 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">削除の確認</h3>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.date}{deleteTarget.note ? `（${deleteTarget.note}）` : ''} の管路図を削除しますか？<br />この操作は元に戻せません。
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
      <h1 className="text-xl font-bold mb-1">管路図</h1>
      <p className="text-xs text-gray-500 mb-4">
        水道・ガス・下水・電気の位置がわかる図面を貼っておく場所です。着工前に全員が見られるようにしてください。
      </p>

      {needsSetup && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
          <p className="text-sm text-amber-800">管路図の準備がまだです。</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Supabaseで <span className="font-mono">supabase-schema-pipe-diagrams.sql</span> を実行すると使えるようになります。
          </p>
        </div>
      )}

      {/* 登録エリア */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">日付</label>
          <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base"
            value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">種別・メモ（任意）</label>
          <input className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={note}
            onChange={e => setNote(e.target.value)} placeholder="例：水道　前面道路から引込み" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {KIND_PRESETS.map(k => (
              <button key={k} type="button" onClick={() => setNote(k)}
                className={`text-xs px-2.5 py-1 rounded-full border ${note === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                {k}
              </button>
            ))}
          </div>
        </div>

        {uploading !== null ? (
          <div className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-200 bg-gray-50 rounded-lg py-6">
            <div className="text-2xl mb-1">⏳</div>
            <p className="text-sm text-gray-500">アップロード中... {uploading}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* 図面をその場で撮る場合 */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg py-6 cursor-pointer transition">
              <div className="text-3xl mb-1">📷</div>
              <p className="text-sm font-medium text-blue-700">撮影する</p>
              <p className="text-xs text-gray-400 mt-1">カメラが開きます</p>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                className="hidden" onChange={handleFiles} />
            </label>
            {/* もらった画像を貼る場合。capture を付けないとアルバムから選べる */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg py-6 cursor-pointer transition">
              <div className="text-3xl mb-1">🖼️</div>
              <p className="text-sm font-medium text-blue-700">アルバムから選ぶ</p>
              <p className="text-xs text-gray-400 mt-1">まとめて選べます</p>
              <input ref={albumInputRef} type="file" accept="image/*" multiple
                className="hidden" onChange={handleFiles} />
            </label>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2 text-center">
          役所や施主からもらった図面、LINEで届いた画像も、アルバムから選んで貼れます
        </p>
      </div>

      {/* 一覧 */}
      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && items.length === 0 && !needsSetup && (
        <p className="text-gray-400 text-center py-10">管路図がありません</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {items.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setEnlarged(p)} className="block w-full text-left">
              <img src={p.photo_url} alt={p.note ?? p.date} className="w-full aspect-[4/3] object-cover" />
            </button>
            <div className="px-2 py-1.5">
              {editing?.id === p.id ? (
                <div className="flex items-center gap-1">
                  <input className="flex-1 min-w-0 border border-gray-200 rounded px-1.5 py-1 text-xs"
                    value={editing.note} autoFocus
                    onChange={e => setEditing({ ...editing, note: e.target.value })} />
                  <button onClick={saveNote} className="text-blue-600 text-xs">✓</button>
                  <button onClick={() => setEditing(null)} className="text-gray-400 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => setEditing({ id: p.id, note: p.note ?? '' })}
                  className="block w-full text-left">
                  <span className="text-xs font-medium text-gray-700 break-all">
                    {p.note || <span className="text-gray-400">種別なし（タップして記入）</span>}
                  </span>
                </button>
              )}
              <p className="text-[11px] text-gray-400">{p.date}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
