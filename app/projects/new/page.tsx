'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function NewProjectPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', location: '', start_date: '', end_date: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.start_date) { setError('現場名と開始日は必須です'); return }
    setSaving(true)
    const { data, error: err } = await supabase.from('projects').insert({
      name: form.name,
      location: form.location,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: 'active',
    }).select().single()
    if (err) { setError(err.message); setSaving(false); return }
    router.push(`/projects/${data.id}`)
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">新規現場登録</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div>
          <label className="block text-sm font-medium mb-1">現場名 *</label>
          <input className="w-full border rounded px-3 py-2" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例：丸の内解体現場" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">場所</label>
          <input className="w-full border rounded px-3 py-2" value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })} placeholder="例：岡山市北区丸の内" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">開始日 *</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={form.start_date}
              onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">終了日</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={form.end_date}
              onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="bg-blue-600 text-white py-2 rounded font-medium disabled:opacity-50">
          {saving ? '登録中...' : '登録する'}
        </button>
        <button type="button" onClick={() => router.back()} className="text-gray-500 text-sm text-center">
          キャンセル
        </button>
      </form>
    </div>
  )
}
