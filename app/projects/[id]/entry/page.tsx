'use client'
import { useEffect, useState } from 'react'
import { supabase, DisposalSite, WasteType } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

type Tab = 'waste' | 'labor' | 'fuel' | 'lease'
type Worker = { id: number; name: string; company_name: string | null }

const LABOR_UNIT_PRICE_TAX_EXCL = 15000
const LABOR_UNIT_PRICE = Math.round(LABOR_UNIT_PRICE_TAX_EXCL * 1.1)

export default function EntryPage() {
  const { id } = useParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('waste')
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<WasteType[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const [wasteForm, setWasteForm] = useState({ date: today, site_id: '', waste_type_id: '', quantity: '' })
  const [laborDate, setLaborDate] = useState(today)
  const [selectedWorkers, setSelectedWorkers] = useState<number[]>([])
  const [otherForm, setOtherForm] = useState({ date: today, unit_price: '', note: '' })

  useEffect(() => { loadMaster() }, [])

  async function loadMaster() {
    const [{ data: s }, { data: w }, { data: wk }] = await Promise.all([
      supabase.from('disposal_sites').select('*').order('name'),
      supabase.from('waste_types').select('*, disposal_sites(name)').order('name'),
      supabase.from('workers').select('*').order('name'),
    ])
    setSites(s ?? [])
    setWasteTypes((w as any) ?? [])
    setWorkers(wk ?? [])
  }

  function toggleWorker(workerId: number) {
    setSelectedWorkers(prev =>
      prev.includes(workerId) ? prev.filter(id => id !== workerId) : [...prev, workerId]
    )
  }

  const filteredTypes = wasteTypes.filter(w => String(w.disposal_site_id) === wasteForm.site_id)
  const selectedType = wasteTypes.find(w => String(w.id) === wasteForm.waste_type_id)
  const estimatedAmount = selectedType && wasteForm.quantity
    ? Math.round(selectedType.unit_price * Number(wasteForm.quantity))
    : null

  async function saveWaste(e: React.FormEvent) {
    e.preventDefault()
    if (!wasteForm.waste_type_id || !wasteForm.quantity) return
    setSaving(true)
    await supabase.from('waste_entries').insert({
      project_id: Number(id),
      waste_type_id: Number(wasteForm.waste_type_id),
      date: wasteForm.date,
      quantity: Number(wasteForm.quantity),
      amount: estimatedAmount ?? 0,
    })
    setSaving(false)
    setSuccess(true)
    setWasteForm({ date: wasteForm.date, site_id: wasteForm.site_id, waste_type_id: '', quantity: '' })
    setTimeout(() => setSuccess(false), 2000)
  }

  async function saveLabor(e: React.FormEvent) {
    e.preventDefault()
    if (selectedWorkers.length === 0) return
    setSaving(true)
    await Promise.all(selectedWorkers.map(workerId =>
      supabase.from('labor_entries').insert({
        project_id: Number(id),
        worker_id: workerId,
        date: laborDate,
        amount: LABOR_UNIT_PRICE,
      })
    ))
    setSaving(false)
    setSuccess(true)
    setSelectedWorkers([])
    setTimeout(() => setSuccess(false), 2000)
  }

  async function saveOther(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(otherForm.unit_price)
    if (!amount) return
    setSaving(true)
    await supabase.from('other_entries').insert({
      project_id: Number(id),
      entry_type: tab,
      date: otherForm.date,
      quantity: 1,
      unit_price: amount,
      amount,
      note: otherForm.note || null,
    })
    setSaving(false)
    setSuccess(true)
    setOtherForm({ date: otherForm.date, unit_price: '', note: '' })
    setTimeout(() => setSuccess(false), 2000)
  }

  const tabClass = (t: Tab) =>
    `flex-1 py-2 text-sm font-medium border-b-2 transition ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`

  return (
    <div>
      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3">← 現場詳細</button>
      <h1 className="text-xl font-bold mb-4">記録入力</h1>

      {success && (
        <div className="bg-green-100 text-green-700 rounded px-3 py-2 mb-3 text-sm">保存しました ✓</div>
      )}

      <div className="flex mb-4 border-b">
        <button className={tabClass('waste')} onClick={() => setTab('waste')}>廃材</button>
        <button className={tabClass('labor')} onClick={() => setTab('labor')}>人工</button>
        <button className={tabClass('fuel')} onClick={() => setTab('fuel')}>燃料代</button>
        <button className={tabClass('lease')} onClick={() => setTab('lease')}>リース代</button>
      </div>

      {tab === 'waste' && (
        <form onSubmit={saveWaste} className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={wasteForm.date}
              onChange={e => setWasteForm({ ...wasteForm, date: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">処分場</label>
            <select className="w-full border rounded px-3 py-2" value={wasteForm.site_id}
              onChange={e => setWasteForm({ ...wasteForm, site_id: e.target.value, waste_type_id: '' })}>
              <option value="">選択してください</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">廃材種類</label>
            <select className="w-full border rounded px-3 py-2" value={wasteForm.waste_type_id}
              onChange={e => setWasteForm({ ...wasteForm, waste_type_id: e.target.value })}
              disabled={!wasteForm.site_id}>
              <option value="">選択してください</option>
              {filteredTypes.map(w => (
                <option key={w.id} value={w.id}>{w.name}（{w.unit_price.toLocaleString()}円/{w.unit}）</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              数量 {selectedType && `(${selectedType.unit})`}
            </label>
            <input type="number" step="0.001" className="w-full border rounded px-3 py-2" value={wasteForm.quantity}
              onChange={e => setWasteForm({ ...wasteForm, quantity: e.target.value })} placeholder="0" />
            {estimatedAmount !== null && (
              <p className="text-sm text-gray-500 mt-1">
                金額: <span className="font-medium text-gray-800">{estimatedAmount.toLocaleString()}円</span>
              </p>
            )}
          </div>
          <button type="submit" disabled={saving || !wasteForm.waste_type_id || !wasteForm.quantity}
            className="bg-blue-600 text-white py-2 rounded font-medium disabled:opacity-50">
            {saving ? '保存中...' : '保存する'}
          </button>
        </form>
      )}

      {tab === 'labor' && (
        <form onSubmit={saveLabor} className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={laborDate}
              onChange={e => setLaborDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">作業員を選択（複数可）</label>
            {workers.length === 0 && (
              <p className="text-sm text-gray-400">マスタページで作業員を登録してください</p>
            )}
            <div className="flex flex-col gap-2">
              {workers.map(w => (
                <label key={w.id} className={`flex items-center gap-3 p-3 rounded border cursor-pointer ${selectedWorkers.includes(w.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={selectedWorkers.includes(w.id)}
                    onChange={() => toggleWorker(w.id)} className="w-4 h-4" />
                  <span className="text-sm">
                    {w.name}
                    {w.company_name && <span className="text-gray-500 ml-1">（{w.company_name}）</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {selectedWorkers.length > 0 && (
            <p className="text-sm text-gray-600">
              {selectedWorkers.length}名 × 16,500円 = <span className="font-bold text-gray-900">{(selectedWorkers.length * LABOR_UNIT_PRICE).toLocaleString()}円</span>（税込）
            </p>
          )}
          <button type="submit" disabled={saving || selectedWorkers.length === 0}
            className="bg-blue-600 text-white py-2 rounded font-medium disabled:opacity-50">
            {saving ? '保存中...' : '保存する'}
          </button>
        </form>
      )}

      {(tab === 'fuel' || tab === 'lease') && (
        <form onSubmit={saveOther} className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={otherForm.date}
              onChange={e => setOtherForm({ ...otherForm, date: e.target.value })} />
          </div>
          {tab === 'fuel' && (
            <div>
              <label className="block text-sm font-medium mb-1">レシート写真から読み取る（任意）</label>
              <label className="flex items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-lg py-4 cursor-pointer hover:border-blue-400 bg-gray-50">
                <div className="text-center">
                  <span className="text-2xl">📷</span>
                  <p className="text-sm text-gray-500 mt-1">タップして写真を選択</p>
                </div>
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setSaving(true)
                    const reader = new FileReader()
                    reader.onload = async (ev) => {
                      const dataUrl = ev.target?.result as string
                      const base64 = dataUrl.split(',')[1]
                      const mediaType = file.type
                      const res = await fetch('/api/analyze-receipt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageBase64: base64, mediaType }),
                      })
                      const data = await res.json()
                      if (data.amount) {
                        setOtherForm(f => ({ ...f, unit_price: String(data.amount) }))
                      }
                      setSaving(false)
                    }
                    reader.readAsDataURL(file)
                  }} />
              </label>
              {saving && <p className="text-sm text-blue-500">読み取り中...</p>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">金額（円）</label>
            <input type="number" className="w-full border rounded px-3 py-2" value={otherForm.unit_price}
              onChange={e => setOtherForm({ ...otherForm, unit_price: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">メモ（任意）</label>
            <input className="w-full border rounded px-3 py-2" value={otherForm.note}
              onChange={e => setOtherForm({ ...otherForm, note: e.target.value })} placeholder="" />
          </div>
          <button type="submit" disabled={saving || !otherForm.unit_price}
            className="bg-blue-600 text-white py-2 rounded font-medium disabled:opacity-50">
            {saving ? '処理中...' : '保存する'}
          </button>
        </form>
      )}
    </div>
  )
}
