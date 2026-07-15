'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase, MeetingNote } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

type Mode = 'list' | 'new' | 'detail'

const today = new Date().toISOString().split('T')[0]

// スマホカメラの写真は数MB〜十数MBあり、そのままbase64送信するとモバイルブラウザがメモリ不足で
// 落ちたりVercelのリクエストサイズ上限を超えたりするため、送信前に縮小・JPEG化する
function resizeImageToBase64(file: File, maxDim = 1600, quality = 0.7): Promise<{ base64: string; mediaType: string }> {
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
      resolve({ base64: canvas.toDataURL('image/jpeg', quality).split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')) }
    img.src = objectUrl
  })
}

export default function MinutesPage() {
  const { id } = useParams()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('list')
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [selected, setSelected] = useState<MeetingNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({ date: today, danger_points: '', cautions: '', notices: '' })
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ danger_points: '', cautions: '', notices: '' })
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [voiceSupported, setVoiceSupported] = useState(true)
  const [recording, setRecording] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [analyzingVoice, setAnalyzingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => { load() }, [id])

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(!!SR)
  }, [])

  function startRecording() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setVoiceError('このブラウザは音声入力に対応していません。写真または直接入力をご利用ください。'); return }
    setVoiceError(null)
    setVoiceText('')
    const recognition = new SR()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (e: any) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      setVoiceText(text)
    }
    recognition.onerror = () => {
      setVoiceError('音声認識でエラーが発生しました。もう一度お試しください。')
      setRecording(false)
    }
    recognition.onend = () => setRecording(false)
    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
  }

  function stopRecording() {
    recognitionRef.current?.stop()
    setRecording(false)
  }

  async function analyzeVoice() {
    if (!voiceText.trim()) return
    setAnalyzingVoice(true)
    setVoiceError(null)
    try {
      const res = await fetch('/api/analyze-voice-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText }),
      })
      if (!res.ok) throw new Error('request failed')
      const json = await res.json()
      setForm(f => ({
        ...f,
        danger_points: json.danger_points || f.danger_points,
        cautions: json.cautions || f.cautions,
        notices: json.notices || f.notices,
      }))
    } catch {
      setVoiceError('AIでの整形に失敗しました。文字起こし内容を確認し、直接入力してください。')
    } finally {
      setAnalyzingVoice(false)
    }
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('meeting_notes')
      .select('*')
      .eq('project_id', id)
      .order('date', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setUploadingPhoto(true)
    try {
      const { base64, mediaType } = await resizeImageToBase64(file)

      // 写真をStorageに保存
      const ext = 'jpg'
      const path = `minutes/${id}/photo_${Date.now()}.${ext}`
      const blob = await (await fetch(`data:${mediaType};base64,${base64}`)).blob()
      await supabase.storage.from('project-files').upload(path, blob, { upsert: false, contentType: mediaType })
      const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
      setPhotoUrl(urlData.publicUrl)
      setUploadingPhoto(false)

      // AI読み取り
      setAnalyzingPhoto(true)
      const res = await fetch('/api/analyze-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      })
      if (!res.ok) throw new Error('request failed')
      const json = await res.json()
      setForm(f => ({
        ...f,
        danger_points: json.danger_points || f.danger_points,
        cautions: json.cautions || f.cautions,
        notices: json.notices || f.notices,
      }))
    } catch {
      setPhotoError('読み取りに失敗しました。内容を直接入力してください。')
    } finally {
      setUploadingPhoto(false)
      setAnalyzingPhoto(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('meeting_notes').insert({
      project_id: Number(id),
      date: form.date,
      danger_points: form.danger_points || null,
      cautions: form.cautions || null,
      notices: form.notices || null,
      photo_url: photoUrl,
    })
    setSaving(false)
    setSuccess(true)
    setForm({ date: today, danger_points: '', cautions: '', notices: '' })
    setPhotoUrl(null)
    setPhotoError(null)
    setVoiceText('')
    setVoiceError(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
    await load()
    setTimeout(() => { setSuccess(false); setMode('list') }, 1000)
  }

  async function saveEdit() {
    if (!selected) return
    setSaving(true)
    await supabase.from('meeting_notes').update({
      danger_points: editForm.danger_points || null,
      cautions: editForm.cautions || null,
      notices: editForm.notices || null,
    }).eq('id', selected.id)
    setSaving(false)
    await load()
    const updated = { ...selected, ...editForm }
    setSelected(updated as MeetingNote)
    setEditing(false)
  }

  async function deleteNote() {
    if (!selected) return
    if (!confirm('この議事録を削除しますか？')) return
    if (selected.photo_url) {
      const path = selected.photo_url.split('/project-files/')[1]
      if (path) await supabase.storage.from('project-files').remove([path])
    }
    await supabase.from('meeting_notes').delete().eq('id', selected.id)
    await load()
    setMode('list')
    setSelected(null)
  }

  function openDetail(note: MeetingNote) {
    setSelected(note)
    setEditForm({
      danger_points: note.danger_points ?? '',
      cautions: note.cautions ?? '',
      notices: note.notices ?? '',
    })
    setEditing(false)
    setMode('detail')
  }

  // --- リスト表示 ---
  if (mode === 'list') return (
    <div>
      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3 py-1">← 現場詳細</button>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">議事録</h1>
        <button onClick={() => setMode('new')} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
          + 新規作成
        </button>
      </div>

      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && notes.length === 0 && (
        <p className="text-gray-400 text-center py-10">議事録がありません</p>
      )}

      <div className="flex flex-col gap-3">
        {notes.map(n => (
          <button key={n.id} onClick={() => openDetail(n)}
            className="bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition w-full">
            <p className="font-bold text-gray-800">{n.date}{n.photo_url && <span className="ml-1 text-sm align-middle">📷</span>}</p>
            <div className="mt-2 flex flex-col gap-1">
              {n.danger_points && (
                <p className="text-sm text-gray-600">
                  <span className="text-red-500 font-medium">⚠ 危険箇所：</span>
                  <span className="line-clamp-1">{n.danger_points}</span>
                </p>
              )}
              {n.cautions && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">注意事項：</span>
                  <span className="line-clamp-1">{n.cautions}</span>
                </p>
              )}
              {n.notices && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">伝達事項：</span>
                  <span className="line-clamp-1">{n.notices}</span>
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  // --- 新規作成 ---
  if (mode === 'new') return (
    <div>
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
      <button onClick={() => setMode('list')} className="text-blue-600 text-sm mb-3 py-1">← 議事録一覧</button>
      <h1 className="text-xl font-bold mb-4">議事録 新規作成</h1>

      {success && <div className="bg-green-100 text-green-700 rounded px-3 py-2 mb-3 text-sm">保存しました ✓</div>}

      <form onSubmit={save} className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">日付</label>
          <input type="date" className="w-full border rounded px-3 py-3"
            value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">手書きメモ写真（AI読み取り・任意）</label>
          {photoUrl ? (
            <div className="relative">
              <img src={photoUrl} alt="議事録メモ"
                className="w-full rounded-lg border object-cover max-h-48 cursor-pointer"
                onClick={() => setEnlarged(photoUrl)} />
              <button type="button"
                onClick={() => { setPhotoUrl(null); setPhotoError(null); if (photoInputRef.current) photoInputRef.current.value = '' }}
                className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm">✕</button>
              {analyzingPhoto && (
                <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                  <p className="text-white text-sm font-medium">AI読み取り中...</p>
                </div>
              )}
            </div>
          ) : (
            <label className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg py-5 cursor-pointer transition
              ${uploadingPhoto || analyzingPhoto ? 'border-blue-200 bg-blue-50' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}`}>
              {uploadingPhoto ? (
                <p className="text-sm text-blue-400">アップロード中...</p>
              ) : analyzingPhoto ? (
                <p className="text-sm text-blue-600 font-medium">AI読み取り中...</p>
              ) : (
                <>
                  <span className="text-2xl mb-1">📷</span>
                  <p className="text-sm font-medium text-blue-700">メモを撮影してAI読み取り</p>
                </>
              )}
              <input ref={photoInputRef} type="file" accept="image/*"
                className="hidden" disabled={uploadingPhoto || analyzingPhoto} onChange={handlePhoto} />
            </label>
          )}
          {photoError && <p className="text-sm text-red-500 mt-1">{photoError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">🎤 音声で記録（AIが文字起こし・誤字修正）</label>
          {!voiceSupported && (
            <p className="text-sm text-gray-400">このブラウザは音声入力に対応していません。写真または直接入力をご利用ください。</p>
          )}
          {voiceSupported && (
            <div className="flex flex-col gap-2">
              {!recording ? (
                <button type="button" onClick={startRecording}
                  className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg py-4">
                  <span className="text-2xl">🎤</span>
                  <span className="text-sm font-medium text-blue-700">タップして録音開始</span>
                </button>
              ) : (
                <button type="button" onClick={stopRecording}
                  className="flex items-center justify-center gap-2 w-full border-2 border-red-300 bg-red-50 rounded-lg py-4 animate-pulse">
                  <span className="text-2xl">⏺</span>
                  <span className="text-sm font-medium text-red-700">録音中...タップして停止</span>
                </button>
              )}
              {voiceText && (
                <>
                  <textarea className="w-full border rounded px-3 py-2 text-sm resize-none bg-gray-50" rows={3}
                    value={voiceText} onChange={e => setVoiceText(e.target.value)}
                    placeholder="文字起こし結果（必要に応じて修正できます）" />
                  <button type="button" onClick={analyzeVoice} disabled={analyzingVoice || recording}
                    className="bg-blue-600 text-white py-2 rounded text-sm font-medium disabled:opacity-50">
                    {analyzingVoice ? 'AIで整形中...' : 'AIで整えてフォームに反映'}
                  </button>
                </>
              )}
              {voiceError && <p className="text-sm text-red-500">{voiceError}</p>}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-red-600">⚠ 危険箇所</label>
          <textarea
            className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
            value={form.danger_points}
            onChange={e => setForm({ ...form, danger_points: e.target.value })}
            placeholder="本日の危険箇所を記入"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">注意事項</label>
          <textarea
            className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
            value={form.cautions}
            onChange={e => setForm({ ...form, cautions: e.target.value })}
            placeholder="作業上の注意事項を記入"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">伝達事項</label>
          <textarea
            className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
            value={form.notices}
            onChange={e => setForm({ ...form, notices: e.target.value })}
            placeholder="連絡事項・伝達内容を記入"
          />
        </div>
        <button type="submit" disabled={saving}
          className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50 text-base">
          {saving ? '保存中...' : '保存する'}
        </button>
      </form>
    </div>
  )

  // --- 詳細表示 ---
  if (mode === 'detail' && selected) return (
    <div>
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
      <button onClick={() => { setMode('list'); setEditing(false) }} className="text-blue-600 text-sm mb-3 py-1">← 議事録一覧</button>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">{selected.date}</h1>
        <div className="flex gap-2">
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="text-sm px-3 py-1.5 border rounded text-blue-600 bg-white">編集</button>
          )}
          <button onClick={deleteNote}
            className="text-sm px-3 py-1.5 border rounded text-red-500 bg-white">削除</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
        {editing ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1 text-red-600">⚠ 危険箇所</label>
              <textarea className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
                value={editForm.danger_points}
                onChange={e => setEditForm({ ...editForm, danger_points: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">注意事項</label>
              <textarea className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
                value={editForm.cautions}
                onChange={e => setEditForm({ ...editForm, cautions: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">伝達事項</label>
              <textarea className="w-full border rounded px-3 py-3 text-sm resize-none" rows={3}
                value={editForm.notices}
                onChange={e => setEditForm({ ...editForm, notices: e.target.value })} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(false)}
                className="flex-1 py-2 border rounded text-gray-600">キャンセル</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50">
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </>
        ) : (
          <>
            {selected.photo_url && (
              <div>
                <p className="text-sm font-bold mb-1 text-gray-700">手書きメモ写真</p>
                <img src={selected.photo_url} alt="議事録メモ"
                  className="w-full rounded-lg border object-cover max-h-64 cursor-pointer"
                  onClick={() => setEnlarged(selected.photo_url)} />
              </div>
            )}
            <Section label="⚠ 危険箇所" color="text-red-600" value={selected.danger_points} />
            <Section label="注意事項" value={selected.cautions} />
            <Section label="伝達事項" value={selected.notices} />
          </>
        )}
      </div>
    </div>
  )

  return null
}

function Section({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div>
      <p className={`text-sm font-bold mb-1 ${color ?? 'text-gray-700'}`}>{label}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded px-3 py-2 min-h-[48px]">
        {value || <span className="text-gray-400">記録なし</span>}
      </p>
    </div>
  )
}
