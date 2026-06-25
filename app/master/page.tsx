'use client'
import { useEffect, useState } from 'react'
import { supabase, DisposalSite, WasteType } from '@/lib/supabase'

export default function MasterPage() {
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<(WasteType & { disposal_sites?: DisposalSite })[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string>('')
  const [newSiteName, setNewSiteName] = useState('')
  const [newWaste, setNewWaste] = useState({ name: '', unit: 'kg', unit_price: '', entry_type: 'cost' })
  const [editingPrice, setEditingPrice] = useState<{ id: number; price: string } | null>(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: s }, { data: w }] = await Promise.all([
      supabase.from('disposal_sites').select('*').order('name'),
      supabase.from('waste_types').select('*, disposal_sites(name)').order('name'),
    ])
    setSites(s ?? [])
    setWasteTypes((w as any) ?? [])
  }

  async function addSite() {
    if (!newSiteName) return
    await supabase.from('disposal_sites').insert({ name: newSiteName })
    setNewSiteName('')
    loadAll()
  }

  async function addWasteType() {
    if (!selectedSiteId || !newWaste.name || !newWaste.unit_price) return
    await supabase.from('waste_types').insert({
      disposal_site_id: Number(selectedSiteId),
      name: newWaste.name,
      unit: newWaste.unit,
      unit_price: Number(newWaste.unit_price),
      entry_type: newWaste.entry_type,
    })
    setNewWaste({ name: '', unit: 'kg', unit_price: '', entry_type: 'cost' })
    loadAll()
  }

  async function updatePrice(id: number, price: string) {
    await supabase.from('waste_types').update({ unit_price: Number(price) }).eq('id', id)
    setEditingPrice(null)
    loadAll()
  }

  async function deleteSite(id: number) {
    if (!confirm('この処分場と関連する廃材種類をすべて削除しますか？')) return
    await supabase.from('disposal_sites').delete().eq('id', id)
    loadAll()
  }

  async function deleteWasteType(id: number) {
    if (!confirm('この廃材種類を削除しますか？')) return
    await supabase.from('waste_types').delete().eq('id', id)
    loadAll()
  }

  const filteredWaste = selectedSiteId
    ? wasteTypes.filter(w => String(w.disposal_site_id) === selectedSiteId)
    : wasteTypes

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">マスタ管理</h1>

      {/* 処分場追加 */}
      <section className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">処分場</h2>
        <div className="flex gap-2 mb-3">
          <input className="flex-1 border rounded px-3 py-2 text-sm" value={newSiteName}
            onChange={e => setNewSiteName(e.target.value)} placeholder="新しい処分場名" />
          <button onClick={addSite} className="bg-blue-600 text-white px-3 py-2 rounded text-sm">追加</button>
        </div>
        <div className="flex flex-col gap-1">
          {sites.map(s => (
            <div key={s.id} className="flex justify-between items-center text-sm py-1 border-b last:border-0">
              <span>{s.name}</span>
              <button onClick={() => deleteSite(s.id)} className="text-gray-300 hover:text-red-400 text-xs">削除</button>
            </div>
          ))}
        </div>
      </section>

      {/* 廃材種類 */}
      <section className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">廃材種類・単価</h2>

        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">処分場で絞り込み</label>
          <select className="w-full border rounded px-3 py-2 text-sm" value={selectedSiteId}
            onChange={e => setSelectedSiteId(e.target.value)}>
            <option value="">すべて</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* 新規廃材追加フォーム */}
        {selectedSiteId && (
          <div className="border rounded p-3 mb-3 bg-gray-50">
            <p className="text-sm font-medium mb-2">新規廃材種類を追加</p>
            <div className="flex flex-col gap-2">
              <input className="border rounded px-3 py-1 text-sm" value={newWaste.name}
                onChange={e => setNewWaste({ ...newWaste, name: e.target.value })} placeholder="廃材名" />
              <div className="flex gap-2">
                <select className="flex-1 border rounded px-2 py-1 text-sm" value={newWaste.unit}
                  onChange={e => setNewWaste({ ...newWaste, unit: e.target.value })}>
                  <option value="kg">kg</option>
                  <option value="㎥">㎥</option>
                  <option value="枚">枚</option>
                  <option value="台">台</option>
                  <option value="本">本</option>
                </select>
                <select className="flex-1 border rounded px-2 py-1 text-sm" value={newWaste.entry_type}
                  onChange={e => setNewWaste({ ...newWaste, entry_type: e.target.value })}>
                  <option value="cost">処分費（支払）</option>
                  <option value="revenue">スクラップ（収益）</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input type="number" className="flex-1 border rounded px-3 py-1 text-sm" value={newWaste.unit_price}
                  onChange={e => setNewWaste({ ...newWaste, unit_price: e.target.value })} placeholder="単価（円）" />
                <button onClick={addWasteType} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">追加</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          {filteredWaste.map(w => (
            <div key={w.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
              <div>
                <span className="text-gray-500 text-xs">{(w as any).disposal_sites?.name}　</span>
                <span>{w.name}</span>
                <span className={`text-xs ml-1 px-1 rounded ${w.entry_type === 'revenue' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {w.entry_type === 'revenue' ? '収益' : '処分費'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {editingPrice?.id === w.id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" className="border rounded px-2 py-1 text-sm w-24"
                      value={editingPrice.price}
                      onChange={e => setEditingPrice({ ...editingPrice, price: e.target.value })} />
                    <span className="text-xs text-gray-500">円/{w.unit}</span>
                    <button onClick={() => updatePrice(w.id, editingPrice.price)} className="text-blue-600 text-xs">✓</button>
                    <button onClick={() => setEditingPrice(null)} className="text-gray-400 text-xs">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingPrice({ id: w.id, price: String(w.unit_price) })}
                    className="text-sm text-gray-700 hover:text-blue-600">
                    {w.unit_price.toLocaleString()}円/{w.unit}
                  </button>
                )}
                <button onClick={() => deleteWasteType(w.id)} className="text-gray-300 hover:text-red-400 text-xs">削除</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
