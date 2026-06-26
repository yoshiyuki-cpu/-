'use client'
import { useEffect, useState } from 'react'
import { supabase, MeetingNote } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

type Mode = 'list' | 'new' | 'detail'

const today = new Date().toISOString().split('T')[0]

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

  useEffect(() => { load() }, [id])

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

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('meeting_notes').insert({
      project_id: Number(id),
      date: form.date,
      danger_points: form.danger_points || null,
      cautions: form.cautions || null,
      notices: form.notices || null,
    })
    setSaving(false)
    setSuccess(true)
    setForm({ date: today, danger_points: '', cautions: '', notices: '' })
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
            <p className="font-bold text-gray-800">{n.date}</p>
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
