'use client'
import { useEffect, useState } from 'react'
import { BillingClient, fetchClients, saveClient } from '@/lib/billing'
import { BillingMe, canEdit } from '@/lib/billingSession'

type Form = { name: string; postal_code: string; address: string; honorific: string; payment_note: string }
const EMPTY: Form = { name: '', postal_code: '', address: '', honorific: '御中', payment_note: '' }
const INPUT = 'mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

export default function ClientsTab({ me }: { me: BillingMe }) {
  const [clients, setClients] = useState<BillingClient[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    try { setClients(await fetchClients()) }
    catch (err) { setMessage(err instanceof Error ? err.message : '読み込めませんでした。') }
    setLoading(false)
  }
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false }
  }, [])

  function edit(c: BillingClient) {
    setEditingId(c.id); setMessage('')
    setForm({ name: c.name, postal_code: c.postal_code ?? '', address: c.address ?? '', honorific: c.honorific, payment_note: c.payment_note ?? '' })
  }

  async function save() {
    if (!form || busy) return
    if (!form.name.trim()) { setMessage('会社名を入れてください。'); return }
    setBusy(true); setMessage('')
    try {
      await saveClient(editingId, {
        name: form.name.trim(), postal_code: form.postal_code.trim() || null, address: form.address.trim() || null,
        honorific: form.honorific.trim() || '御中', payment_note: form.payment_note.trim() || null,
      })
      setForm(null); setEditingId(null)
      await load()
      setMessage('保存しました。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
    setBusy(false)
  }

  async function toggle(c: BillingClient) {
    try {
      await saveClient(c.id, { active: !c.active })
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  return (
    <div className="flex flex-col gap-3">
      {canEdit(me) && !form && (
        <button onClick={() => { setEditingId(null); setForm({ ...EMPTY }); setMessage('') }} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium">＋ 元請を登録する</button>
      )}
      {message && <p className="text-sm text-blue-800 bg-blue-50 rounded-xl px-3 py-2">{message}</p>}
      {form && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
          <label className="text-sm font-medium">会社名<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={INPUT} /></label>
          <label className="text-sm font-medium">郵便番号<input value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} placeholder="702-0000" className={INPUT} /></label>
          <label className="text-sm font-medium">住所<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className={INPUT} /></label>
          <label className="text-sm font-medium">敬称<input value={form.honorific} onChange={e => setForm({ ...form, honorific: e.target.value })} className={INPUT} /></label>
          <label className="text-sm font-medium">支払条件のメモ（なくても可）<input value={form.payment_note} onChange={e => setForm({ ...form, payment_note: e.target.value })} placeholder="月末締め翌月末払い" className={INPUT} /></label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">{busy ? '保存中...' : '保存'}</button>
            <button onClick={() => setForm(null)} className="flex-1 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm">やめる</button>
          </div>
        </div>
      )}
      {clients.length === 0 && <p className="text-sm text-gray-500 text-center py-6">まだ元請がありません。請求書の宛先になる会社を登録してください。</p>}
      <div className="flex flex-col gap-2">
        {clients.map(c => (
          <div key={c.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-3 ${c.active ? '' : 'opacity-60'}`}>
            <p className="text-sm font-medium">{c.name}　{c.honorific}{c.active ? '' : '（使わない）'}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.postal_code ? `〒${c.postal_code}　` : ''}{c.address ?? '住所 未登録'}</p>
            {c.payment_note && <p className="text-xs text-gray-500 mt-0.5">{c.payment_note}</p>}
            {canEdit(me) && (
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => edit(c)} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">直す</button>
                <button onClick={() => toggle(c)} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">{c.active ? '使わない' : '使う'}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
