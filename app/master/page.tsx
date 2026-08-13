'use client'
import { useEffect, useState } from 'react'
import { supabase, DisposalSite, WasteType, CompanySettings, Vehicle, ScaffoldMaterialPrice, FuelPrice } from '@/lib/supabase'
import Link from 'next/link'

type Worker = { id: number; name: string; company_name: string | null; email: string | null; is_foreman: boolean }
type ProjectOption = { id: number; name: string; status: 'active' | 'completed' }

export default function MasterPage() {
  const [tab, setTab] = useState<'disposal' | 'worker' | 'vehicle' | 'scaffold' | 'fuel' | 'company'>('disposal')
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<(WasteType & { disposal_sites?: DisposalSite })[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [activeProjects, setActiveProjects] = useState<ProjectOption[]>([])
  const [foremanProjectIds, setForemanProjectIds] = useState<Record<number, number[]>>({})
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [scaffoldPrices, setScaffoldPrices] = useState<ScaffoldMaterialPrice[]>([])
  const [newScaffoldUsage, setNewScaffoldUsage] = useState('')
  const [editingScaffoldPrice, setEditingScaffoldPrice] = useState<{ id: number; price: string } | null>(null)
  const [fuelPrices, setFuelPrices] = useState<FuelPrice[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string>('')
  const [newSiteName, setNewSiteName] = useState('')
  const [newWaste, setNewWaste] = useState({ name: '', unit: 'kg', unit_price: '', entry_type: 'cost' })
  const [editingPrice, setEditingPrice] = useState<{ id: number; price: string } | null>(null)
  const [newWorker, setNewWorker] = useState({ name: '', company_name: '', email: '', is_foreman: false })
  const [editingWorkerId, setEditingWorkerId] = useState<number | null>(null)
  const [editingWorkerProjectIds, setEditingWorkerProjectIds] = useState<number[]>([])
  const [testSending, setTestSending] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<{ id: number; text: string } | null>(null)
  const [newVehicle, setNewVehicle] = useState({ name: '', category: 'rental' as 'rental' | 'owned', default_price: '', unit: '日' })
  const [editingVehiclePrice, setEditingVehiclePrice] = useState<{ id: number; price: string } | null>(null)
  const [editingFuelPrice, setEditingFuelPrice] = useState<{ id: number; price: string } | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [savingCompany, setSavingCompany] = useState(false)
  const [uploadingStamp, setUploadingStamp] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: s }, { data: w }, { data: wk }, { data: v }, { data: sp }, { data: fp }, { data: c }, { data: pj }, { data: fpj }] = await Promise.all([
      supabase.from('disposal_sites').select('*').order('name'),
      supabase.from('waste_types').select('*, disposal_sites(name)').order('name'),
      supabase.from('workers').select('*').order('name'),
      supabase.from('vehicles').select('*').order('category').order('name'),
      supabase.from('scaffold_material_prices').select('*').order('category').order('sort_order'),
      supabase.from('fuel_prices').select('*').order('fuel_type'),
      supabase.from('company_settings').select('*').eq('id', 1).single(),
      supabase.from('projects').select('id, name, status').eq('status', 'active').order('name'),
      supabase.from('foreman_projects').select('worker_id, project_id'),
    ])
    setSites(s ?? [])
    setWasteTypes((w as any) ?? [])
    setWorkers(wk ?? [])
    setVehicles(v ?? [])
    setScaffoldPrices(sp ?? [])
    setFuelPrices(fp ?? [])
    setCompany(c)
    setActiveProjects(pj ?? [])
    const grouped: Record<number, number[]> = {}
    ;(fpj ?? []).forEach((l: any) => {
      grouped[l.worker_id] = [...(grouped[l.worker_id] ?? []), l.project_id]
    })
    setForemanProjectIds(grouped)
  }

  async function updateScaffoldPrice(id: number, price: string) {
    await supabase.from('scaffold_material_prices').update({ unit_price: price ? Number(price) : null }).eq('id', id)
    setEditingScaffoldPrice(null)
    loadAll()
  }

  async function addScaffoldUsagePrice() {
    if (!newScaffoldUsage) return
    const nextOrder = Math.max(0, ...scaffoldPrices.filter(p => p.category === 'usage').map(p => p.sort_order)) + 1
    await supabase.from('scaffold_material_prices').insert({ category: 'usage', label: newScaffoldUsage, sort_order: nextOrder })
    setNewScaffoldUsage('')
    loadAll()
  }

  async function deleteScaffoldUsagePrice(id: number) {
    if (!confirm('この用途別部材の単価を削除しますか？')) return
    await supabase.from('scaffold_material_prices').delete().eq('id', id)
    loadAll()
  }

  async function updateFuelPrice(id: number, price: string) {
    if (!price) return
    await supabase.from('fuel_prices').update({ unit_price: Number(price), updated_at: new Date().toISOString() }).eq('id', id)
    setEditingFuelPrice(null)
    loadAll()
  }

  async function saveCompany() {
    if (!company) return
    setSavingCompany(true)
    await supabase.from('company_settings').update({
      name: company.name,
      postal_code: company.postal_code,
      address: company.address,
      office_name: company.office_name,
      tel: company.tel,
      fax: company.fax,
      email: company.email,
      license_no: company.license_no,
      representative: company.representative,
    }).eq('id', 1)
    setSavingCompany(false)
  }

  async function handleStampUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !company) return
    setUploadingStamp(true)
    const ext = file.name.split('.').pop()
    const path = `company/stamp.${ext}`
    await supabase.storage.from('project-files').upload(path, file, { upsert: true })
    const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
    await supabase.from('company_settings').update({ stamp_url: urlData.publicUrl }).eq('id', 1)
    setCompany({ ...company, stamp_url: urlData.publicUrl })
    setUploadingStamp(false)
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
    const { error } = await supabase.from('disposal_sites').delete().eq('id', id)
    if (error) {
      alert('この処分場は使用実績（廃材記録）があるため削除できません。先に現場側の記録を削除するか、廃材種類だけを使わないようにしてください。')
      return
    }
    loadAll()
  }

  async function deleteWasteType(id: number) {
    if (!confirm('この廃材種類を削除しますか？')) return
    const { error } = await supabase.from('waste_types').delete().eq('id', id)
    if (error) {
      alert('この廃材種類は使用実績（廃材記録）があるため削除できません。')
      return
    }
    loadAll()
  }

  async function addWorker() {
    if (!newWorker.name) return
    await supabase.from('workers').insert({
      name: newWorker.name,
      company_name: newWorker.company_name || null,
      email: newWorker.email || null,
      is_foreman: newWorker.is_foreman,
    })
    setNewWorker({ name: '', company_name: '', email: '', is_foreman: false })
    loadAll()
  }

  async function deleteWorker(id: number) {
    if (!confirm('この作業員を削除しますか？')) return
    const { error } = await supabase.from('workers').delete().eq('id', id)
    if (error) {
      alert('この作業員は使用実績（人工記録）があるため削除できません。')
      return
    }
    loadAll()
  }

  function startEditWorker(w: Worker) {
    setEditingWorkerId(w.id)
    setEditingWorkerProjectIds(foremanProjectIds[w.id] ?? [])
  }

  async function saveWorkerForeman(w: Worker, email: string, isForeman: boolean) {
    await supabase.from('workers').update({ email: email || null, is_foreman: isForeman }).eq('id', w.id)
    if (isForeman) {
      await supabase.from('foreman_projects').delete().eq('worker_id', w.id)
      if (editingWorkerProjectIds.length > 0) {
        await supabase.from('foreman_projects').insert(
          editingWorkerProjectIds.map(project_id => ({ worker_id: w.id, project_id }))
        )
      }
    }
    setEditingWorkerId(null)
    loadAll()
  }

  function toggleEditingProject(id: number) {
    setEditingWorkerProjectIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function sendTestNotification(workerId: number) {
    setTestSending(workerId)
    setTestResult(null)
    try {
      const res = await fetch('/api/notify-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult({ id: workerId, text: `失敗: ${data.error ?? 'エラー'}` })
      } else if (!data.hasEmail && !data.hasPush) {
        setTestResult({ id: workerId, text: 'メールアドレス未登録・プッシュ通知未登録のため送信できません。' })
      } else {
        const parts: string[] = []
        if (data.emailAttempted) parts.push(data.emailError ? `メール失敗(${data.emailError})` : 'メール送信済み')
        if (data.pushAttempted) parts.push(data.pushError ? `通知失敗(${data.pushError})` : '通知送信済み')
        setTestResult({ id: workerId, text: parts.join(' / ') })
      }
    } catch {
      setTestResult({ id: workerId, text: '失敗: 通信エラー' })
    }
    setTestSending(null)
  }

  async function addVehicle() {
    if (!newVehicle.name) return
    await supabase.from('vehicles').insert({
      name: newVehicle.name,
      category: newVehicle.category,
      default_price: newVehicle.default_price ? Number(newVehicle.default_price) : null,
      unit: newVehicle.unit || '日',
    })
    setNewVehicle({ name: '', category: 'rental', default_price: '', unit: '日' })
    loadAll()
  }

  async function updateVehiclePrice(id: number, price: string) {
    await supabase.from('vehicles').update({ default_price: price ? Number(price) : null }).eq('id', id)
    setEditingVehiclePrice(null)
    loadAll()
  }

  async function deleteVehicle(id: number) {
    if (!confirm('この車両・重機を削除しますか？')) return
    const { error } = await supabase.from('vehicles').delete().eq('id', id)
    if (error) {
      alert('この車両・重機は使用実績（車両代記録）があるため削除できません。')
      return
    }
    loadAll()
  }

  const filteredWaste = selectedSiteId
    ? wasteTypes.filter(w => String(w.disposal_site_id) === selectedSiteId)
    : wasteTypes

  const tabClass = (t: string) =>
    `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">マスタ管理</h1>
        <div className="flex gap-1.5">
          <Link href="/usage" className="text-sm text-blue-600 border border-gray-200 bg-white rounded-full px-3 py-1.5">📊 利用状況</Link>
          <Link href="/tools" className="text-sm text-blue-600 border border-gray-200 bg-white rounded-full px-3 py-1.5">🧰 置き場道具管理</Link>
          <Link href="/notifications" className="text-sm text-blue-600 border border-gray-200 bg-white rounded-full px-3 py-1.5">🔔 通知設定</Link>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        <button className={tabClass('disposal')} onClick={() => setTab('disposal')}>処分場・廃材</button>
        <button className={tabClass('worker')} onClick={() => setTab('worker')}>作業員</button>
        <button className={tabClass('vehicle')} onClick={() => setTab('vehicle')}>車両・重機</button>
        <button className={tabClass('scaffold')} onClick={() => setTab('scaffold')}>足場材料単価</button>
        <button className={tabClass('fuel')} onClick={() => setTab('fuel')}>燃料単価</button>
        <button className={tabClass('company')} onClick={() => setTab('company')}>会社情報</button>
      </div>

      {tab === 'disposal' && (
        <>
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <h2 className="font-bold mb-3 text-gray-700">処分場</h2>
            <div className="flex gap-2 mb-3">
              <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newSiteName}
                onChange={e => setNewSiteName(e.target.value)} placeholder="新しい処分場名" />
              <button onClick={addSite} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">追加</button>
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

          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
            <h2 className="font-bold mb-3 text-gray-700">廃材種類・単価</h2>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">処分場で絞り込み</label>
              <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={selectedSiteId}
                onChange={e => setSelectedSiteId(e.target.value)}>
                <option value="">すべて</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {selectedSiteId && (
              <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-gray-50">
                <p className="text-sm font-medium mb-2">新規廃材種類を追加</p>
                <div className="flex flex-col gap-2">
                  <input className="border border-gray-200 rounded-xl px-3 py-1 text-sm" value={newWaste.name}
                    onChange={e => setNewWaste({ ...newWaste, name: e.target.value })} placeholder="廃材名" />
                  <div className="flex gap-2">
                    <select className="flex-1 border border-gray-200 rounded-xl px-2 py-1 text-sm" value={newWaste.unit}
                      onChange={e => setNewWaste({ ...newWaste, unit: e.target.value })}>
                      <option value="kg">kg</option>
                      <option value="トン">トン</option>
                      <option value="㎥">㎥</option>
                      <option value="枚">枚</option>
                      <option value="台">台</option>
                      <option value="本">本</option>
                    </select>
                    <select className="flex-1 border border-gray-200 rounded-xl px-2 py-1 text-sm" value={newWaste.entry_type}
                      onChange={e => setNewWaste({ ...newWaste, entry_type: e.target.value })}>
                      <option value="cost">処分費（支払）</option>
                      <option value="revenue">スクラップ（収益）</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input type="number" inputMode="decimal" step="0.01" className="flex-1 border border-gray-200 rounded-xl px-3 py-1 text-sm" value={newWaste.unit_price}
                      onChange={e => setNewWaste({ ...newWaste, unit_price: e.target.value })} placeholder="単価（円、小数可）" />
                    <button onClick={addWasteType} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm">追加</button>
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
                        <input type="number" inputMode="decimal" step="0.01" className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-24"
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
        </>
      )}

      {tab === 'worker' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold mb-3 text-gray-700">作業員</h2>
          <p className="text-xs text-gray-500 mb-3">
            「職長」に設定すると、担当現場を選べます。担当現場が設定された職長には、朝7:50に議事録・KY活動、夕方17:30に工事台帳記入・写真貼り付けのリマインダー（メール・通知）が届きます。
            メール送信には<Link href="/notifications" className="text-blue-600 underline">通知設定</Link>ページで本人の端末登録も必要です。
          </p>
          <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-gray-50">
            <p className="text-sm font-medium mb-2">新規作業員を追加</p>
            <div className="flex flex-col gap-2">
              <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newWorker.name}
                onChange={e => setNewWorker({ ...newWorker, name: e.target.value })} placeholder="作業員名" />
              <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newWorker.company_name}
                onChange={e => setNewWorker({ ...newWorker, company_name: e.target.value })} placeholder="協力会社名（任意）" />
              <input type="email" className="border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newWorker.email}
                onChange={e => setNewWorker({ ...newWorker, email: e.target.value })} placeholder="メールアドレス（任意）" />
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={newWorker.is_foreman}
                  onChange={e => setNewWorker({ ...newWorker, is_foreman: e.target.checked })} />
                職長として登録する
              </label>
              <button onClick={addWorker} className="bg-blue-600 text-white py-2 rounded-lg text-sm">追加</button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {workers.map(w => (
              <div key={w.id} className="py-2 border-b last:border-0">
                <div className="flex justify-between items-center text-sm">
                  <span>
                    {w.name}
                    {w.company_name && <span className="text-gray-500 ml-1">（{w.company_name}）</span>}
                    {w.is_foreman && <span className="text-xs ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">職長</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEditWorker(w)} className="text-blue-600 text-xs">設定</button>
                    <button onClick={() => deleteWorker(w.id)} className="text-gray-300 hover:text-red-400 text-xs">削除</button>
                  </div>
                </div>
                {w.email && <p className="text-xs text-gray-400 mt-0.5">{w.email}</p>}

                {editingWorkerId === w.id && (
                  <div className="mt-2 border border-gray-200 rounded-xl p-3 bg-gray-50 flex flex-col gap-2">
                    <input type="email" className="border border-gray-200 rounded-xl px-3 py-2 text-sm" defaultValue={w.email ?? ''}
                      id={`email-${w.id}`} placeholder="メールアドレス" />
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked={w.is_foreman} id={`foreman-${w.id}`} />
                      職長として登録する
                    </label>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">担当現場（アクティブな現場のみ表示）</p>
                      <div className="flex flex-col gap-1">
                        {activeProjects.length === 0 && <p className="text-xs text-gray-400">アクティブな現場がありません</p>}
                        {activeProjects.map(p => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={editingWorkerProjectIds.includes(p.id)}
                              onChange={() => toggleEditingProject(p.id)} />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const emailInput = document.getElementById(`email-${w.id}`) as HTMLInputElement
                          const foremanInput = document.getElementById(`foreman-${w.id}`) as HTMLInputElement
                          saveWorkerForeman(w, emailInput.value, foremanInput.checked)
                        }}
                        className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm">保存</button>
                      <button onClick={() => setEditingWorkerId(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm">キャンセル</button>
                    </div>
                    <button onClick={() => sendTestNotification(w.id)} disabled={testSending === w.id}
                      className="border border-blue-300 text-blue-600 py-2 rounded-lg text-sm disabled:opacity-50">
                      {testSending === w.id ? '送信中...' : '📧 テスト送信（保存済みの内容へ）'}
                    </button>
                    {testResult?.id === w.id && (
                      <p className="text-xs text-gray-600">{testResult.text}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'vehicle' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold mb-3 text-gray-700">車両・重機</h2>
          <p className="text-xs text-gray-500 mb-3">
            単価を設定すると入力画面で自動入力されますが、その場での金額変更もできます。月極リースなど金額が変動する場合は単価を空欄のままにできます。
          </p>
          <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-gray-50">
            <p className="text-sm font-medium mb-2">新規車両・重機を追加</p>
            <div className="flex flex-col gap-2">
              <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newVehicle.name}
                onChange={e => setNewVehicle({ ...newVehicle, name: e.target.value })} placeholder="車両・重機名" />
              <div className="flex gap-2">
                <button type="button" onClick={() => setNewVehicle({ ...newVehicle, category: 'rental' })}
                  className={`flex-1 py-2 rounded border text-sm font-medium ${newVehicle.category === 'rental' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                  リース
                </button>
                <button type="button" onClick={() => setNewVehicle({ ...newVehicle, category: 'owned' })}
                  className={`flex-1 py-2 rounded border text-sm font-medium ${newVehicle.category === 'owned' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                  自社
                </button>
              </div>
              <div className="flex gap-2">
                <input type="number" inputMode="decimal" step="0.01" className="flex-1 border border-gray-200 rounded-xl px-3 py-1 text-sm" value={newVehicle.default_price}
                  onChange={e => setNewVehicle({ ...newVehicle, default_price: e.target.value })} placeholder="基本単価（円・任意）" />
                <input className="w-20 border border-gray-200 rounded-xl px-3 py-1 text-sm" value={newVehicle.unit}
                  onChange={e => setNewVehicle({ ...newVehicle, unit: e.target.value })} placeholder="単位" />
              </div>
              <button onClick={addVehicle} className="bg-blue-600 text-white py-2 rounded-lg text-sm">追加</button>
            </div>
          </div>

          {(['rental', 'owned'] as const).map(cat => (
            <div key={cat} className="mb-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">{cat === 'rental' ? 'リース' : '自社'}</p>
              {vehicles.filter(v => v.category === cat).length === 0 && (
                <p className="text-sm text-gray-400 pb-2">登録なし</p>
              )}
              <div className="flex flex-col gap-1">
                {vehicles.filter(v => v.category === cat).map(v => (
                  <div key={v.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                    <span>{v.name}</span>
                    <div className="flex items-center gap-2">
                      {editingVehiclePrice?.id === v.id ? (
                        <div className="flex items-center gap-1">
                          <input type="number" inputMode="decimal" step="0.01" className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-24"
                            value={editingVehiclePrice.price}
                            onChange={e => setEditingVehiclePrice({ ...editingVehiclePrice, price: e.target.value })} />
                          <span className="text-xs text-gray-500">円/{v.unit}</span>
                          <button onClick={() => updateVehiclePrice(v.id, editingVehiclePrice.price)} className="text-blue-600 text-xs">✓</button>
                          <button onClick={() => setEditingVehiclePrice(null)} className="text-gray-400 text-xs">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingVehiclePrice({ id: v.id, price: v.default_price ? String(v.default_price) : '' })}
                          className="text-sm text-gray-700 hover:text-blue-600">
                          {v.default_price ? `${v.default_price.toLocaleString()}円/${v.unit}` : '単価未設定'}
                        </button>
                      )}
                      <button onClick={() => deleteVehicle(v.id)} className="text-gray-300 hover:text-red-400 text-xs">削除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'scaffold' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold mb-3 text-gray-700">足場材料単価</h2>
          <p className="text-xs text-gray-500 mb-3">
            足場計算画面（現場ごと・グローバル電卓とも共通）の資材コスト概算に使われます。単価未設定の項目は0円で計算されます。
          </p>

          <p className="text-xs font-semibold text-gray-500 mb-1">単管（長さ別・円/本）</p>
          <div className="flex flex-col gap-1 mb-4">
            {scaffoldPrices.filter(p => p.category === 'pipe').map(p => (
              <div key={p.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                <span>{p.label}m</span>
                {editingScaffoldPrice?.id === p.id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" inputMode="decimal" step="0.01" className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-24"
                      value={editingScaffoldPrice.price}
                      onChange={e => setEditingScaffoldPrice({ ...editingScaffoldPrice, price: e.target.value })} />
                    <span className="text-xs text-gray-500">円/本</span>
                    <button onClick={() => updateScaffoldPrice(p.id, editingScaffoldPrice.price)} className="text-blue-600 text-xs">✓</button>
                    <button onClick={() => setEditingScaffoldPrice(null)} className="text-gray-400 text-xs">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingScaffoldPrice({ id: p.id, price: p.unit_price ? String(p.unit_price) : '' })}
                    className="text-sm text-gray-700 hover:text-blue-600">
                    {p.unit_price ? `${p.unit_price.toLocaleString()}円/本` : '単価未設定'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs font-semibold text-gray-500 mb-1">用途別部材（円/本）</p>
          <div className="flex gap-2 mb-3">
            <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" value={newScaffoldUsage}
              onChange={e => setNewScaffoldUsage(e.target.value)} placeholder="新しい用途名（例：単管クランプ）" />
            <button onClick={addScaffoldUsagePrice} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">追加</button>
          </div>
          <div className="flex flex-col gap-1">
            {scaffoldPrices.filter(p => p.category === 'usage').map(p => (
              <div key={p.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                <span>{p.label}</span>
                <div className="flex items-center gap-2">
                  {editingScaffoldPrice?.id === p.id ? (
                    <div className="flex items-center gap-1">
                      <input type="number" inputMode="decimal" step="0.01" className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-24"
                        value={editingScaffoldPrice.price}
                        onChange={e => setEditingScaffoldPrice({ ...editingScaffoldPrice, price: e.target.value })} />
                      <span className="text-xs text-gray-500">円/本</span>
                      <button onClick={() => updateScaffoldPrice(p.id, editingScaffoldPrice.price)} className="text-blue-600 text-xs">✓</button>
                      <button onClick={() => setEditingScaffoldPrice(null)} className="text-gray-400 text-xs">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingScaffoldPrice({ id: p.id, price: p.unit_price ? String(p.unit_price) : '' })}
                      className="text-sm text-gray-700 hover:text-blue-600">
                      {p.unit_price ? `${p.unit_price.toLocaleString()}円/本` : '単価未設定'}
                    </button>
                  )}
                  <button onClick={() => deleteScaffoldUsagePrice(p.id)} className="text-gray-300 hover:text-red-400 text-xs">削除</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'fuel' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold mb-3 text-gray-700">燃料単価</h2>
          <p className="text-xs text-gray-500 mb-3">
            記録入力の燃料代で種類（軽油／レギュラー）を選ぶと、ここで設定した単価が自動入力されます。相場が変わったらここで基本単価を更新してください。入力時にその場で単価を上書きすることもできます。
          </p>
          <div className="flex flex-col gap-1">
            {fuelPrices.map(fp => (
              <div key={fp.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                <span>{fp.fuel_type}</span>
                {editingFuelPrice?.id === fp.id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" inputMode="decimal" step="0.01" className="border border-gray-200 rounded-xl px-2 py-1 text-sm w-24"
                      value={editingFuelPrice.price}
                      onChange={e => setEditingFuelPrice({ ...editingFuelPrice, price: e.target.value })} />
                    <span className="text-xs text-gray-500">円/L</span>
                    <button onClick={() => updateFuelPrice(fp.id, editingFuelPrice.price)} className="text-blue-600 text-xs">✓</button>
                    <button onClick={() => setEditingFuelPrice(null)} className="text-gray-400 text-xs">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingFuelPrice({ id: fp.id, price: String(fp.unit_price) })}
                    className="text-sm text-gray-700 hover:text-blue-600">
                    {fp.unit_price.toLocaleString()}円/L
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'company' && company && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold mb-3 text-gray-700">会社情報（見積書に表示されます）</h2>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">会社名</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.name}
                onChange={e => setCompany({ ...company, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">郵便番号</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.postal_code ?? ''}
                onChange={e => setCompany({ ...company, postal_code: e.target.value })} placeholder="例：700-0000" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">住所</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.address ?? ''}
                onChange={e => setCompany({ ...company, address: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">事務所名（任意）</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.office_name ?? ''}
                onChange={e => setCompany({ ...company, office_name: e.target.value })} placeholder="例：豊浜事務所B101" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">電話番号</label>
                <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.tel ?? ''}
                  onChange={e => setCompany({ ...company, tel: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">FAX番号</label>
                <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.fax ?? ''}
                  onChange={e => setCompany({ ...company, fax: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mailアドレス</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.email ?? ''}
                onChange={e => setCompany({ ...company, email: e.target.value })} placeholder="例：info@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">建設業許可番号</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.license_no ?? ''}
                onChange={e => setCompany({ ...company, license_no: e.target.value })} placeholder="例：岡山県知事許可（般-6）第00000号" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">代表者名</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" value={company.representative ?? ''}
                onChange={e => setCompany({ ...company, representative: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">印鑑（ハンコ）画像</label>
              {company.stamp_url && <img src={company.stamp_url} alt="印" className="w-20 h-20 object-contain mb-2 border rounded" />}
              <input type="file" accept="image/*" onChange={handleStampUpload} disabled={uploadingStamp} className="text-sm" />
              {uploadingStamp && <p className="text-xs text-gray-500 mt-1">アップロード中...</p>}
            </div>
            <button onClick={saveCompany} disabled={savingCompany}
              className="bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {savingCompany ? '保存中...' : '保存する'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
