'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DisposalSite, WasteType, Estimate, EstimateWasteItem, EstimateExtraItem, EstimateStatus } from '@/lib/supabase'
import { calcEstimateTotals, STRUCTURE_OPTIONS, INCIDENTAL_PRESETS } from '@/lib/estimateCalc'

type WasteRow = { key: string; waste_type_id: number | null; name: string; unit: string; quantity: string; unit_price: string }
type ExtraRow = { key: string; name: string; amount: string }

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円'

function emptyForm() {
  return {
    customer_name: '',
    customer_address: '',
    customer_contact: '',
    site_address: '',
    building_structure: STRUCTURE_OPTIONS[0],
    floor_area: '',
    unit_price: '',
    expense_rate: '0',
    discount_amount: '0',
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
  initial?: { estimate: Estimate; wasteItems: EstimateWasteItem[]; extraItems: EstimateExtraItem[] }
}) {
  const router = useRouter()
  const keyCounter = useRef(0)
  const nextKey = () => `k${keyCounter.current++}`

  const [form, setForm] = useState(emptyForm())
  const [wasteRows, setWasteRows] = useState<WasteRow[]>([])
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([])
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<WasteType[]>([])
  const [pickerSiteId, setPickerSiteId] = useState('')
  const [pickerWasteTypeId, setPickerWasteTypeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('disposal_sites').select('*').order('name').then(({ data }) => setSites(data ?? []))
    supabase.from('waste_types').select('*').order('name').then(({ data }) => setWasteTypes((data as any) ?? []))
  }, [])

  useEffect(() => {
    if (!initial) return
    const e = initial.estimate
    setForm({
      customer_name: e.customer_name,
      customer_address: e.customer_address ?? '',
      customer_contact: e.customer_contact ?? '',
      site_address: e.site_address ?? '',
      building_structure: e.building_structure ?? STRUCTURE_OPTIONS[0],
      floor_area: e.floor_area != null ? String(e.floor_area) : '',
      unit_price: e.unit_price != null ? String(e.unit_price) : '',
      expense_rate: String(e.expense_rate),
      discount_amount: String(e.discount_amount),
      tax_rate: String(e.tax_rate),
      status: e.status,
      issue_date: e.issue_date,
      valid_until: e.valid_until ?? '',
      notes: e.notes ?? '',
    })
    setWasteRows(initial.wasteItems.map(w => ({
      key: nextKey(), waste_type_id: w.waste_type_id, name: w.name, unit: w.unit,
      quantity: String(w.quantity), unit_price: String(w.unit_price),
    })))
    setExtraRows(initial.extraItems.map(x => ({ key: nextKey(), name: x.name, amount: String(x.amount) })))
  }, [initial])

  const filteredWasteTypes = pickerSiteId ? wasteTypes.filter(w => String(w.disposal_site_id) === pickerSiteId) : wasteTypes

  function addWasteRowFromMaster() {
    const wt = wasteTypes.find(w => String(w.id) === pickerWasteTypeId)
    if (!wt) return
    setWasteRows(rows => [...rows, {
      key: nextKey(), waste_type_id: wt.id, name: wt.name, unit: wt.unit,
      quantity: '', unit_price: String(wt.unit_price),
    }])
    setPickerWasteTypeId('')
  }

  function addCustomWasteRow() {
    setWasteRows(rows => [...rows, { key: nextKey(), waste_type_id: null, name: '', unit: 'kg', quantity: '', unit_price: '' }])
  }

  function updateWasteRow(key: string, patch: Partial<WasteRow>) {
    setWasteRows(rows => rows.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function removeWasteRow(key: string) {
    setWasteRows(rows => rows.filter(r => r.key !== key))
  }

  function addExtraRow(name: string) {
    setExtraRows(rows => [...rows, { key: nextKey(), name, amount: '' }])
  }

  function updateExtraRow(key: string, patch: Partial<ExtraRow>) {
    setExtraRows(rows => rows.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function removeExtraRow(key: string) {
    setExtraRows(rows => rows.filter(r => r.key !== key))
  }

  const buildingAmount = (Number(form.floor_area) || 0) * (Number(form.unit_price) || 0)

  const totals = useMemo(() => calcEstimateTotals(
    { building_amount: buildingAmount, expense_rate: Number(form.expense_rate) || 0, discount_amount: Number(form.discount_amount) || 0, tax_rate: Number(form.tax_rate) || 0 },
    wasteRows.map(r => ({ quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 })),
    extraRows.map(r => ({ amount: Number(r.amount) || 0 })),
  ), [buildingAmount, form.expense_rate, form.discount_amount, form.tax_rate, wasteRows, extraRows])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.customer_name) { setError('お客様名は必須です'); return }
    setSaving(true)
    setError('')

    const payload = {
      customer_name: form.customer_name,
      customer_address: form.customer_address || null,
      customer_contact: form.customer_contact || null,
      site_address: form.site_address || null,
      building_structure: form.building_structure || null,
      floor_area: form.floor_area ? Number(form.floor_area) : null,
      unit_price: form.unit_price ? Number(form.unit_price) : null,
      building_amount: buildingAmount,
      expense_rate: Number(form.expense_rate) || 0,
      discount_amount: Number(form.discount_amount) || 0,
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
      await supabase.from('estimate_waste_items').delete().eq('estimate_id', id)
      await supabase.from('estimate_extra_items').delete().eq('estimate_id', id)
    }

    const wastePayload = wasteRows
      .filter(r => r.name)
      .map((r, i) => ({
        estimate_id: id, waste_type_id: r.waste_type_id, name: r.name, unit: r.unit,
        quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0, sort_order: i,
      }))
    if (wastePayload.length) await supabase.from('estimate_waste_items').insert(wastePayload)

    const extraPayload = extraRows
      .filter(r => r.name)
      .map((r, i) => ({ estimate_id: id, name: r.name, amount: Number(r.amount) || 0, sort_order: i }))
    if (extraPayload.length) await supabase.from('estimate_extra_items').insert(extraPayload)

    router.push(`/estimates/${id}`)
  }

  const inputClass = 'w-full border rounded px-3 py-2 text-sm'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-32">
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">お客様情報</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">お客様名 *</label>
            <input className={inputClass} value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="例：山田太郎 様" />
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
            <label className="block text-sm font-medium mb-1">現場住所</label>
            <input className={inputClass} value={form.site_address} onChange={e => setForm({ ...form, site_address: e.target.value })} placeholder="例：岡山市南区豊浜町〇〇" />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">解体工事本体</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">建物構造</label>
            <select className={inputClass} value={form.building_structure} onChange={e => setForm({ ...form, building_structure: e.target.value })}>
              {STRUCTURE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">延床面積（㎡）</label>
            <input type="number" className={inputClass} value={form.floor_area} onChange={e => setForm({ ...form, floor_area: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">㎡単価（円）</label>
            <input type="number" className={inputClass} value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-between items-center bg-gray-50 rounded px-3 py-2 text-sm">
          <span className="text-gray-600">本体工事金額</span>
          <span className="font-bold">{fmt(buildingAmount)}</span>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">廃材処分費</h2>
        <div className="border rounded p-3 mb-3 bg-gray-50">
          <p className="text-sm font-medium mb-2">マスタから追加</p>
          <div className="flex flex-col gap-2">
            <select className={inputClass} value={pickerSiteId} onChange={e => { setPickerSiteId(e.target.value); setPickerWasteTypeId('') }}>
              <option value="">処分場を選択</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex gap-2">
              <select className={inputClass} value={pickerWasteTypeId} onChange={e => setPickerWasteTypeId(e.target.value)}>
                <option value="">廃材種類を選択</option>
                {filteredWasteTypes.map(w => <option key={w.id} value={w.id}>{w.name}（{w.unit_price.toLocaleString()}円/{w.unit}）</option>)}
              </select>
              <button type="button" onClick={addWasteRowFromMaster} className="bg-blue-600 text-white px-3 py-2 rounded text-sm whitespace-nowrap">追加</button>
            </div>
          </div>
          <button type="button" onClick={addCustomWasteRow} className="text-blue-600 text-xs mt-2">+ 自由入力で項目を追加</button>
        </div>

        <div className="flex flex-col gap-3">
          {wasteRows.map(row => (
            <div key={row.key} className="border rounded p-3">
              <div className="flex justify-between items-start gap-2 mb-2">
                <input className={`${inputClass} flex-1`} value={row.name} placeholder="廃材名"
                  onChange={e => updateWasteRow(row.key, { name: e.target.value })} />
                <button type="button" onClick={() => removeWasteRow(row.key)} className="text-gray-300 hover:text-red-400 text-xs shrink-0 py-2">削除</button>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <input type="number" className={inputClass} placeholder="数量" value={row.quantity}
                  onChange={e => updateWasteRow(row.key, { quantity: e.target.value })} />
                <input className={inputClass} placeholder="単位" value={row.unit}
                  onChange={e => updateWasteRow(row.key, { unit: e.target.value })} />
                <input type="number" className={inputClass} placeholder="単価" value={row.unit_price}
                  onChange={e => updateWasteRow(row.key, { unit_price: e.target.value })} />
              </div>
              <p className="text-right text-sm text-gray-600 mt-1">{fmt((Number(row.quantity) || 0) * (Number(row.unit_price) || 0))}</p>
            </div>
          ))}
          {wasteRows.length === 0 && <p className="text-gray-400 text-sm text-center py-2">項目がありません</p>}
        </div>
        <div className="flex justify-between items-center bg-gray-50 rounded px-3 py-2 text-sm mt-3">
          <span className="text-gray-600">廃材処分費 合計</span>
          <span className="font-bold">{fmt(totals.wasteTotal)}</span>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">付帯工事</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {INCIDENTAL_PRESETS.map(p => (
            <button key={p} type="button" onClick={() => addExtraRow(p)}
              className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">+ {p}</button>
          ))}
          <button type="button" onClick={() => addExtraRow('')}
            className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">+ その他</button>
        </div>
        <div className="flex flex-col gap-2">
          {extraRows.map(row => (
            <div key={row.key} className="flex gap-2 items-center">
              <input className={`${inputClass} flex-1`} placeholder="項目名" value={row.name}
                onChange={e => updateExtraRow(row.key, { name: e.target.value })} />
              <input type="number" className={`${inputClass} w-28`} placeholder="金額" value={row.amount}
                onChange={e => updateExtraRow(row.key, { amount: e.target.value })} />
              <button type="button" onClick={() => removeExtraRow(row.key)} className="text-gray-300 hover:text-red-400 text-xs shrink-0">削除</button>
            </div>
          ))}
          {extraRows.length === 0 && <p className="text-gray-400 text-sm text-center py-2">項目がありません</p>}
        </div>
        <div className="flex justify-between items-center bg-gray-50 rounded px-3 py-2 text-sm mt-3">
          <span className="text-gray-600">付帯工事 合計</span>
          <span className="font-bold">{fmt(totals.extraTotal)}</span>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="font-bold mb-3 text-gray-700">諸経費・値引き・その他</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium mb-1">諸経費率（%）</label>
            <input type="number" className={inputClass} value={form.expense_rate} onChange={e => setForm({ ...form, expense_rate: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">値引き額（円）</label>
            <input type="number" className={inputClass} value={form.discount_amount} onChange={e => setForm({ ...form, discount_amount: e.target.value })} />
          </div>
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
          <textarea className={`${inputClass} resize-none`} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
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
            <span>諸経費</span><span className="text-right">{fmt(totals.expenseAmount)}</span>
            <span>消費税</span><span className="text-right">{fmt(totals.taxAmount)}</span>
          </div>
          <div className="flex justify-between items-center border-t pt-2">
            <span className="font-bold text-gray-700">見積合計（税込）</span>
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
