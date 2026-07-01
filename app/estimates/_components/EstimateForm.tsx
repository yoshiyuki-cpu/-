'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Estimate, EstimateItem, EstimateStatus } from '@/lib/supabase'
import { calcEstimateTotals, UNIT_OPTIONS, ITEM_PRESETS, itemAmount } from '@/lib/estimateCalc'

type ItemRow = { key: string; name: string; quantity: string; unit: string; unit_price: string }

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円'

function emptyForm() {
  return {
    customer_name: '',
    customer_honorific: '様',
    customer_address: '',
    customer_contact: '',
    estimate_no: '',
    project_name: '',
    site_address: '',
    construction_period: '',
    payment_due_date: '',
    payment_terms: '',
    assignee: '',
    tax_rate: '10',
    status: 'draft' as EstimateStatus,
    issue_date: new Date().toISOString().slice(0, 10),
    valid_until: '',
    notes: '',
  }
}

export default function EstimateForm({
  mode,
  estimateId,
  initial,
}: {
  mode: 'new' | 'edit'
  estimateId?: number
  initial?: { estimate: Estimate; items: EstimateItem[] }
}) {
  const router = useRouter()
  const keyCounter = useRef(0)
  const nextKey = () => `k${keyCounter.current++}`

  const [form, setForm] = useState(emptyForm())
  const [rows, setRows] = useState<ItemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initial) return
    const e = initial.estimate
    setForm({
      customer_name: e.customer_name,
      customer_honorific: e.customer_honorific,
      customer_address: e.customer_address ?? '',
      customer_contact: e.customer_contact ?? '',
      estimate_no: e.estimate_no ?? '',
      project_name: e.project_name ?? '',
      site_address: e.site_address ?? '',
      construction_period: e.construction_period ?? '',
      payment_due_date: e.payment_due_date ?? '',
      payment_terms: e.payment_terms ?? '',
      assignee: e.assignee ?? '',
      tax_rate: String(e.tax_rate),
      status: e.status,
      issue_date: e.issue_date,
      valid_until: e.valid_until ?? '',
      notes: e.notes ?? '',
    })
    setRows(initial.items.map(i => ({
      key: nextKey(), name: i.name, quantity: String(i.quantity), unit: i.unit, unit_price: String(i.unit_price),
    })))
  }, [initial])

  function addRow(name = '') {
    setRows(rs => [...rs, { key: nextKey(), name, quantity: '1', unit: '式', unit_price: '' }])
  }

  function updateRow(key: string, patch: Partial<ItemRow>) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function removeRow(key: string) {
    setRows(rs => rs.filter(r => r.key !== key))
  }

  const totals = useMemo(() => calcEstimateTotals(
    { tax_rate: Number(form.tax_rate) || 0 },
    rows.map(r => ({ quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 })),
  ), [form.tax_rate, rows])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.customer_name) { setError('お客様名は必須です'); return }
    setSaving(true)
    setError('')

    const payload = {
      customer_name: form.customer_name,
      customer_honorific: form.customer_honorific,
      customer_address: form.customer_address || null,
      customer_contact: form.customer_contact || null,
      estimate_no: form.estimate_no || null,
      project_name: form.project_name || null,
      site_address: form.site_address || null,
      construction_period: form.construction_period || null,
      payment_due_date: form.payment_due_date || null,
      payment_terms: form.payment_terms || null,
      assignee: form.assignee || null,
      tax_rate: Number(form.tax_rate) || 0,
      status: form.status,
      issue_date: form.issue_date,
      valid_until: form.valid_until || null,
      notes: form.notes || null,
    }

    let id = estimateId

    if (mode === 'new') {
      const { data, error: err } = await supabase.from('estimates').insert(payload).select().single()
      if (err || !data) { setError(err?.message ?? '保存に失敗しました'); setSaving(false); return }
      id = data.id
    } else {
      const { error: err } = await supabase.from('estimates').update(payload).eq('id', id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('estimate_items').delete().eq('estimate_id', id)
    }

    const itemsPayload = rows
      .filter(r => r.name)
      .map((r, i) => ({
        estimate_id: id, name: r.name, quantity: Number(r.quantity) || 0,
        unit: r.unit, unit_price: Number(r.unit_price) || 0, sort_order: i,
      }))
    if (itemsPayload.length) await supabase.from('estimate_items').insert(itemsPayload)

    router.push(`/estimates/${id}`)
  }

  const inputClass = 'w-full border rounded px-3 py-2 text-sm'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-32">
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">お客様・現場情報</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">お客様名 *</label>
            <div className="flex gap-2">
              <input className={inputClass} value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="例：大野" />
              <select className="border rounded px-3 py-2 text-sm w-24" value={form.customer_honorific} onChange={e => setForm({ ...form, customer_honorific: e.target.value })}>
                <option value="様">様</option>
                <option value="御中">御中</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ご住所</label>
            <input className={inputClass} value={form.customer_address} onChange={e => setForm({ ...form, customer_address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">連絡先（電話番号等）</label>
            <input className={inputClass} value={form.customer_contact} onChange={e => setForm({ ...form, customer_contact: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">件名</label>
            <input className={inputClass} value={form.project_name} onChange={e => setForm({ ...form, project_name: e.target.value })} placeholder="例：〇〇邸木造二階建家屋解体工事" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">現場住所</label>
            <input className={inputClass} value={form.site_address} onChange={e => setForm({ ...form, site_address: e.target.value })} placeholder="例：岡山市南区豊浜町〇〇" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">工期</label>
              <input className={inputClass} value={form.construction_period} onChange={e => setForm({ ...form, construction_period: e.target.value })} placeholder="例：契約後1ヶ月以内" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">支払期日</label>
              <input className={inputClass} value={form.payment_due_date} onChange={e => setForm({ ...form, payment_due_date: e.target.value })} placeholder="例：完工後10日以内" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">支払条件</label>
              <input className={inputClass} value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} placeholder="例：現金100%" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">見積No</label>
              <input className={inputClass} value={form.estimate_no} onChange={e => setForm({ ...form, estimate_no: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">担当者</label>
              <input className={inputClass} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })} placeholder="例：武田" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">見積日</label>
              <input type="date" className={inputClass} value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">明細</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {ITEM_PRESETS.map(p => (
            <button key={p} type="button" onClick={() => addRow(p)}
              className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">+ {p}</button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {rows.map((row, idx) => (
            <div key={row.key} className="border rounded p-3">
              <div className="flex justify-between items-start gap-2 mb-2">
                <span className="text-xs text-gray-400 pt-2">No.{idx + 1}</span>
                <input className={`${inputClass} flex-1`} value={row.name} placeholder="項目名"
                  onChange={e => updateRow(row.key, { name: e.target.value })} />
                <button type="button" onClick={() => removeRow(row.key)} className="text-gray-300 hover:text-red-400 text-xs shrink-0 py-2">削除</button>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <input type="number" className={inputClass} placeholder="単価" value={row.unit_price}
                  onChange={e => updateRow(row.key, { unit_price: e.target.value })} />
                <input type="number" className={inputClass} placeholder="数量" value={row.quantity}
                  onChange={e => updateRow(row.key, { quantity: e.target.value })} />
                <select className={inputClass} value={row.unit} onChange={e => updateRow(row.key, { unit: e.target.value })}>
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <p className="text-right text-sm text-gray-600 mt-1">{fmt(itemAmount({ quantity: Number(row.quantity) || 0, unit_price: Number(row.unit_price) || 0 }))}</p>
            </div>
          ))}
          {rows.length === 0 && <p className="text-gray-400 text-sm text-center py-2">項目がありません</p>}
          <button type="button" onClick={() => addRow()} className="text-blue-600 text-sm text-left">+ 項目を追加</button>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">その他</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium mb-1">消費税率（%）</label>
            <input type="number" className={inputClass} value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">見積有効期限</label>
            <input type="date" className={inputClass} value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">備考</label>
          <textarea className={`${inputClass} resize-none`} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="例：※残置物撤去費用は、別途お見積もりいたします。" />
        </div>
        {mode === 'edit' && (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">ステータス</label>
            <select className={inputClass} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as EstimateStatus })}>
              <option value="draft">作成中</option>
              <option value="sent">提出済み</option>
              <option value="accepted">受注</option>
              <option value="rejected">失注</option>
            </select>
          </div>
        )}
      </section>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg px-4 py-3 no-print">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-gray-600">
            <span>小計</span><span className="text-right">{fmt(totals.subtotal)}</span>
            <span>税額</span><span className="text-right">{fmt(totals.taxAmount)}</span>
          </div>
          <div className="flex justify-between items-center border-t pt-2">
            <span className="font-bold text-gray-700">合計金額（税込）</span>
            <span className="font-bold text-lg text-blue-700">{fmt(totals.total)}</span>
          </div>
          <button type="submit" disabled={saving} className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50 text-base">
            {saving ? '保存中...' : mode === 'new' ? '見積りを登録する' : '更新する'}
          </button>
        </div>
      </div>
    </form>
  )
}
