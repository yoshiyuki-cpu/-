'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase, DisposalSite, WasteType, Vehicle, FuelPrice } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { jstToday } from '@/lib/date'
import { loadChecklist, undoneItems, ChecklistState } from '@/lib/checklist'
import { isOffline, isNetworkError, enqueue } from '@/lib/offlineQueue'

type Tab = 'waste' | 'labor' | 'fuel' | 'lease' | 'expense'
type Worker = { id: number; name: string; company_name: string | null }

const LABOR_UNIT_PRICE_TAX_EXCL = 15000
const LABOR_UNIT_PRICE = Math.round(LABOR_UNIT_PRICE_TAX_EXCL * 1.1)
const LABOR_UNIT_PRICE_HALF = Math.round(LABOR_UNIT_PRICE / 2)
type DayType = 'full' | 'half'

// ブラウザの音声認識（Web Speech API）。型定義が標準に無いので必要な分だけ書く
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void
}

// スマホカメラの写真は数MB〜十数MBあり、そのままbase64送信するとモバイルブラウザがメモリ不足で
// 落ちたり(画面が真っ黒になる)Vercelのリクエストサイズ上限を超えたりするため、送信前に縮小・JPEG化する
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

export default function EntryPage() {
  const { id } = useParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('waste')
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<WasteType[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [fuelPrices, setFuelPrices] = useState<FuelPrice[]>([])
  const [recordedVehicleIds, setRecordedVehicleIds] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  // 圏外で端末に貯めたとき、その旨を出す
  const [queued, setQueued] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)

  // 保存する。圏外なら端末に貯める。回線以外の理由で断られたら false
  async function insertOrQueue(table: string, rows: Record<string, unknown>[], label: string): Promise<'sent' | 'queued' | 'error'> {
    if (isOffline()) { enqueue(table, rows, label); return 'queued' }
    const { error } = await supabase.from(table).insert(rows)
    if (!error) return 'sent'
    if (isNetworkError(error)) { enqueue(table, rows, label); return 'queued' }
    return 'error'
  }

  function showSaved(result: 'sent' | 'queued') {
    setQueued(result === 'queued')
    setSuccess(true)
    setTimeout(() => { setSuccess(false); setQueued(false) }, result === 'queued' ? 4000 : 2000)
  }
  // 着工前の確認が揃っていない間、入力画面の上で知らせる（入力は止めない）
  const [checkState, setCheckState] = useState<ChecklistState | null>(null)

  // 人工の音声入力。「横山と田中、全日。松尾は半日」→ 選択に反映。保存は職長が押す
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    setVoiceSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition))
  }, [])

  function startVoice() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) { setVoiceMsg('このブラウザは音声入力に対応していません。名前を押して選んでください。'); return }
    setVoiceMsg(null); setVoiceText('')
    const rec = new SR()
    rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true
    rec.onresult = (e) => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript
      setVoiceText(t)
    }
    rec.onerror = () => { setVoiceMsg('音声を聞き取れませんでした。もう一度押して話してください。'); setRecording(false) }
    rec.onend = () => setRecording(false)
    recognitionRef.current = rec
    rec.start()
    setRecording(true)
  }

  function stopVoice() {
    recognitionRef.current?.stop()
    setRecording(false)
  }

  async function applyVoice() {
    if (!voiceText.trim()) return
    setVoiceBusy(true); setVoiceMsg(null)
    try {
      const res = await fetch('/api/analyze-voice-labor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText, workers: workers.map(w => ({ id: w.id, name: w.name })) }),
      })
      if (!res.ok) throw new Error('request failed')
      const json = await res.json() as { entries: { worker_id: number; day_type: DayType }[]; unmatched: string[]; failed?: boolean }
      // 登録済み（二重登録防止）の人は入れない
      const picked = json.entries.filter(e => !(e.worker_id in laborDone))
      if (picked.length === 0) {
        setVoiceMsg(json.failed ? '読み取れませんでした。名前を押して選んでください。' : '一覧にある名前が聞き取れませんでした。名前を押して選んでください。')
      } else {
        setWorkerDayType(prev => {
          const next = { ...prev }
          picked.forEach(e => { next[e.worker_id] = e.day_type })
          return next
        })
        const names = picked.map(e => `${workers.find(w => w.id === e.worker_id)?.name ?? ''}${e.day_type === 'half' ? '（半日）' : ''}`)
        setVoiceMsg(`${names.join('・')} を選びました。確認して「保存する」を押してください。`
          + (json.unmatched.length ? `　※聞き取れなかった名前：${json.unmatched.join('・')}` : ''))
      }
    } catch {
      setVoiceMsg('読み取りに失敗しました。名前を押して選んでください。')
    } finally {
      setVoiceBusy(false)
    }
  }

  const today = jstToday()
  const [wasteForm, setWasteForm] = useState({ date: today, site_id: '', waste_type_id: '', quantity: '' })
  const [laborDate, setLaborDate] = useState(today)
  const [workerDayType, setWorkerDayType] = useState<Record<number, DayType>>({})
  // この現場・この日にすでに入っている人工。二重登録を防ぐために使う
  const [laborDone, setLaborDone] = useState<Record<number, DayType>>({})
  const [otherForm, setOtherForm] = useState({
    date: today, unit_price: '', note: '', quantity: '', fuel_type: '' as '' | '軽油' | 'レギュラー',
    vehicle_category: '' as '' | 'rental' | 'owned', vehicle_id: '', liter_price: '', mobilization_fee: '',
  })

  useEffect(() => { loadMaster() }, [])
  useEffect(() => { loadLaborDone() }, [id, laborDate])

  // 同じ現場・同じ日に人工を二度入れてしまう事故があったため、登録済みの人を先に読む
  async function loadLaborDone() {
    const { data } = await supabase.from('labor_entries')
      .select('worker_id, day_type').eq('project_id', Number(id)).eq('date', laborDate)
    const map: Record<number, DayType> = {}
    ;(data ?? []).forEach((e: { worker_id: number; day_type: DayType }) => {
      // 半日が2回入っている場合もあるので、最初に見つけた区分を出す
      if (!(e.worker_id in map)) map[e.worker_id] = e.day_type ?? 'full'
    })
    setLaborDone(map)
    // 日付を変えたときに、前の日付で選んでいた人が残らないようにする
    setWorkerDayType(prev => {
      const next: Record<number, DayType> = {}
      for (const [wid, dt] of Object.entries(prev)) {
        if (!(Number(wid) in map)) next[Number(wid)] = dt
      }
      return next
    })
  }

  async function loadMaster() {
    const [{ data: s }, { data: w }, { data: wk }, { data: v }, { data: le }, { data: fp }] = await Promise.all([
      supabase.from('disposal_sites').select('*').order('name'),
      supabase.from('waste_types').select('*, disposal_sites(name)').order('name'),
      supabase.from('workers').select('*').order('name'),
      supabase.from('vehicles').select('*').order('name'),
      supabase.from('other_entries').select('vehicle_id').eq('project_id', Number(id)).eq('entry_type', 'lease').not('vehicle_id', 'is', null),
      supabase.from('fuel_prices').select('*'),
    ])
    setSites(s ?? [])
    setWasteTypes((w as any) ?? [])
    setWorkers(wk ?? [])
    setVehicles(v ?? [])
    setRecordedVehicleIds(new Set(((le ?? []) as { vehicle_id: number }[]).map(e => e.vehicle_id)))
    setFuelPrices(fp ?? [])
    // 確認の読み込みは入力を待たせない（失敗しても入力は普通にできる）
    loadChecklist(supabase, Number(id)).then(setCheckState).catch(() => setCheckState(null))
  }

  const isFirstVehicleUse = tab === 'lease' && !!otherForm.vehicle_id && !recordedVehicleIds.has(Number(otherForm.vehicle_id))
  const selectedVehicle = vehicles.find(v => String(v.id) === otherForm.vehicle_id)

  function toggleWorker(workerId: number) {
    if (workerId in laborDone) return
    setWorkerDayType(prev => {
      if (workerId in prev) {
        const { [workerId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [workerId]: 'full' }
    })
  }

  function setWorkerDay(workerId: number, dayType: DayType) {
    setWorkerDayType(prev => ({ ...prev, [workerId]: dayType }))
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
    const result = await insertOrQueue('waste_entries', [{
      project_id: Number(id),
      waste_type_id: Number(wasteForm.waste_type_id),
      date: wasteForm.date,
      quantity: Number(wasteForm.quantity),
      amount: estimatedAmount ?? 0,
    }], `廃材 ${selectedType?.name ?? ''} ${wasteForm.quantity}${selectedType?.unit ?? ''}（${wasteForm.date.slice(5).replace('-', '/')}）`)
    setSaving(false)
    if (result === 'error') { alert('保存できませんでした。もう一度お試しください。'); return }
    showSaved(result)
    // 日付・処分場を引き継ぎ、廃材種類と数量のみリセット
    setWasteForm(f => ({ ...f, waste_type_id: '', quantity: '' }))
  }

  async function saveLabor(e: React.FormEvent) {
    e.preventDefault()
    if (Object.keys(workerDayType).length === 0) return
    setSaving(true)
    // 保存を押す直前にもう一度DBを見る。別の職長が同じ日を入れていた場合に重ねないため。
    // 圏外ではこの確認ができないので、画面で読めていた分（laborDone）だけで判断する
    let already = new Set<number>(Object.keys(laborDone).map(Number))
    if (!isOffline()) {
      const { data: latest } = await supabase.from('labor_entries')
        .select('worker_id').eq('project_id', Number(id)).eq('date', laborDate)
      if (latest) already = new Set(latest.map((e: { worker_id: number }) => e.worker_id))
    }
    const entries = Object.entries(workerDayType).filter(([workerId]) => !already.has(Number(workerId)))
    if (entries.length === 0) {
      setSaving(false)
      setWorkerDayType({})
      await loadLaborDone()
      return
    }
    const rows = entries.map(([workerId, dayType]) => ({
      project_id: Number(id),
      worker_id: Number(workerId),
      date: laborDate,
      day_type: dayType,
      amount: dayType === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE,
    }))
    const result = await insertOrQueue('labor_entries', rows, `人工 ${rows.length}名（${laborDate.slice(5).replace('-', '/')}）`)
    setSaving(false)
    if (result === 'error') { alert('保存できませんでした。もう一度お試しください。'); return }
    showSaved(result)
    setWorkerDayType({})
    if (result === 'sent') await loadLaborDone()
  }

  async function saveOther(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(otherForm.unit_price)
    if (!amount) return
    // 「0」は回送費なしとして通す。未入力（空欄）のときだけ止める
    if (isFirstVehicleUse && otherForm.mobilization_fee.trim() === '') return
    setSaving(true)
    const vehicleId = tab === 'lease' && otherForm.vehicle_id ? Number(otherForm.vehicle_id) : null
    const rows = [{
      project_id: Number(id),
      entry_type: tab,
      date: otherForm.date,
      quantity: tab === 'fuel' && otherForm.quantity ? Number(otherForm.quantity) : 1,
      unit_price: amount,
      amount,
      note: otherForm.note || null,
      fuel_type: tab === 'fuel' ? (otherForm.fuel_type || null) : null,
      vehicle_id: vehicleId,
    }]
    const mobilizationAmount = Number(otherForm.mobilization_fee)
    // 回送費0（自走するトラックなど）のときは回送費の行を作らない
    if (isFirstVehicleUse && vehicleId && mobilizationAmount > 0) {
      rows.push({
        project_id: Number(id),
        entry_type: tab,
        date: otherForm.date,
        quantity: 1,
        unit_price: mobilizationAmount,
        amount: mobilizationAmount,
        note: '回送費',
        fuel_type: null,
        vehicle_id: vehicleId,
      })
    }
    const tabLabel = tab === 'fuel' ? '燃料代' : tab === 'lease' ? '車両代' : '経費'
    const result = await insertOrQueue('other_entries', rows, `${tabLabel} ${amount.toLocaleString()}円（${otherForm.date.slice(5).replace('-', '/')}）`)
    setSaving(false)
    if (result === 'error') { alert('保存できませんでした。もう一度お試しください。'); return }
    if (vehicleId) setRecordedVehicleIds((prev: Set<number>) => new Set(prev).add(vehicleId))
    showSaved(result)
    setOtherForm({ date: otherForm.date, unit_price: '', note: '', quantity: '', fuel_type: '', vehicle_category: '', vehicle_id: '', liter_price: '', mobilization_fee: '' })
  }

  const tabClass = (t: Tab) =>
    `flex-1 shrink-0 whitespace-nowrap px-3 py-2 rounded-full text-sm font-medium text-center transition ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`

  return (
    <div>
      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3">← 現場詳細</button>
      <h1 className="text-xl font-bold mb-4">記録入力</h1>

      {checkState && !checkState.missingTable && undoneItems(checkState).length > 0 && (
        <Link href={`/projects/${id}`}
          className="block bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-sm text-amber-900">
          <span className="font-semibold">着工前の確認が {undoneItems(checkState).length} 件残っています：</span>
          {undoneItems(checkState).map(i => i.label.replace(/を.*$/, '')).join('・')}
          <span className="block text-[11px] text-amber-700 mt-0.5">現場詳細で確認して押してください（入力はこのまま続けられます）</span>
        </Link>
      )}

      {success && !queued && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-3 py-2 mb-3 text-sm font-medium">保存しました ✓</div>
      )}
      {success && queued && (
        <div className="bg-amber-50 text-amber-900 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-sm font-medium">
          圏外なので端末に貯めました。つながったら自動で送ります ✓
        </div>
      )}

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        <button className={tabClass('waste')} onClick={() => setTab('waste')}>廃材</button>
        <button className={tabClass('labor')} onClick={() => setTab('labor')}>人工</button>
        <button className={tabClass('fuel')} onClick={() => setTab('fuel')}>燃料代</button>
        <button className={tabClass('lease')} onClick={() => setTab('lease')}>車両代</button>
        <button className={tabClass('expense')} onClick={() => setTab('expense')}>経費</button>
      </div>

      {tab === 'waste' && (
        <form onSubmit={saveWaste} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={wasteForm.date}
              onChange={e => setWasteForm({ ...wasteForm, date: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">処分場</label>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={wasteForm.site_id}
              onChange={e => setWasteForm({ ...wasteForm, site_id: e.target.value, waste_type_id: '' })}>
              <option value="">選択してください</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">廃材種類</label>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={wasteForm.waste_type_id}
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
            <input type="number" step="0.001" inputMode="decimal" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={wasteForm.quantity}
              onChange={e => setWasteForm({ ...wasteForm, quantity: e.target.value })} placeholder="0" />
            {estimatedAmount !== null && (
              <p className="text-sm text-gray-500 mt-1">
                金額: <span className="font-medium text-gray-800">{estimatedAmount.toLocaleString()}円</span>
              </p>
            )}
          </div>
          <button type="submit" disabled={saving || !wasteForm.waste_type_id || !wasteForm.quantity}
            className="bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50 text-base">
            {saving ? '保存中...' : '保存する'}
          </button>
        </form>
      )}

      {tab === 'labor' && (
        <form onSubmit={saveLabor} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={laborDate}
              onChange={e => setLaborDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">作業員を選択（複数可）</label>
            {workers.length === 0 && (
              <p className="text-sm text-gray-400">マスタページで作業員を登録してください</p>
            )}

            {/* 声で選ぶ。手袋のまま使える。結果は選択に入るだけで、保存は下のボタン */}
            {voiceSupported && workers.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-gray-50">
                <div className="flex gap-2">
                  {!recording ? (
                    <button type="button" onClick={startVoice} disabled={voiceBusy}
                      className="flex-1 py-2.5 rounded-xl bg-white border border-blue-300 text-blue-700 text-sm font-medium disabled:opacity-40">
                      🎤 声で選ぶ
                    </button>
                  ) : (
                    <button type="button" onClick={stopVoice}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium">
                      ■ 話し終わった
                    </button>
                  )}
                  {voiceText && !recording && (
                    <button type="button" onClick={applyVoice} disabled={voiceBusy}
                      className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40">
                      {voiceBusy ? '読み取り中...' : '読み取って選ぶ'}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  {recording ? '例：「横山と田中、全日。松尾は半日」' : voiceText ? `聞き取り：${voiceText}` : '押して、今日働いた人の名前と全日か半日かを話してください'}
                </p>
                {voiceMsg && <p className="text-xs text-blue-800 mt-1.5">{voiceMsg}</p>}
              </div>
            )}
            {Object.keys(laborDone).length > 0 && (
              <p className="text-xs text-gray-500 mb-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                この日はすでに{Object.keys(laborDone).length}名分が登録されています。二重に付かないよう、その人は選べません。直すときは現場詳細の人工記録から。
              </p>
            )}
            <div className="flex flex-col gap-2">
              {workers.map(w => {
                const dayType = workerDayType[w.id]
                const selected = dayType !== undefined
                const done = laborDone[w.id]
                return (
                  <div key={w.id} className={`rounded border p-3 ${done ? 'border-gray-200 bg-gray-50' : selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                    <label className={`flex items-center gap-3 ${done ? 'cursor-default' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={selected} disabled={!!done}
                        onChange={() => toggleWorker(w.id)} className="w-4 h-4" />
                      <span className={`text-sm ${done ? 'text-gray-400' : ''}`}>
                        {w.name}
                        {w.company_name && <span className={done ? 'ml-1' : 'text-gray-500 ml-1'}>（{w.company_name}）</span>}
                      </span>
                      {done && (
                        <span className="ml-auto text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">
                          登録済み{done === 'half' ? '（半日）' : ''}
                        </span>
                      )}
                    </label>
                    {selected && (
                      <div className="flex gap-2 mt-2 ml-7">
                        <button type="button" onClick={() => setWorkerDay(w.id, 'full')}
                          className={`px-3 py-1 rounded text-xs font-medium border ${dayType === 'full' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                          1日
                        </button>
                        <button type="button" onClick={() => setWorkerDay(w.id, 'half')}
                          className={`px-3 py-1 rounded text-xs font-medium border ${dayType === 'half' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                          半日
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {Object.keys(workerDayType).length > 0 && (
            <p className="text-sm text-gray-600">
              {Object.keys(workerDayType).length}名 = <span className="font-bold text-gray-900">
                {Object.values(workerDayType).reduce((s, dt) => s + (dt === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE), 0).toLocaleString()}円
              </span>（税込）
            </p>
          )}
          <button type="submit" disabled={saving || Object.keys(workerDayType).length === 0}
            className="bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50 text-base">
            {saving ? '保存中...' : '保存する'}
          </button>
        </form>
      )}

      {(tab === 'fuel' || tab === 'lease' || tab === 'expense') && (
        <form onSubmit={saveOther} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.date}
              onChange={e => setOtherForm({ ...otherForm, date: e.target.value })} />
          </div>
          {tab === 'lease' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">区分</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOtherForm({ ...otherForm, vehicle_category: 'rental', vehicle_id: '' })}
                    className={`flex-1 py-3 rounded border text-sm font-medium ${otherForm.vehicle_category === 'rental' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                    リース
                  </button>
                  <button type="button" onClick={() => setOtherForm({ ...otherForm, vehicle_category: 'owned', vehicle_id: '' })}
                    className={`flex-1 py-3 rounded border text-sm font-medium ${otherForm.vehicle_category === 'owned' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                    自社
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">車両・重機</label>
                <select className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.vehicle_id}
                  disabled={!otherForm.vehicle_category}
                  onChange={e => {
                    const vid = e.target.value
                    const v = vehicles.find(v => String(v.id) === vid)
                    setOtherForm(f => ({
                      ...f, vehicle_id: vid,
                      unit_price: v?.default_price ? String(v.default_price) : f.unit_price,
                      // マスタに回送費があれば入れておく（0=回送費なしも含む）。無ければ従来通り手入力
                      mobilization_fee: v?.default_mobilization_fee != null ? String(v.default_mobilization_fee) : '',
                    }))
                  }}>
                  <option value="">選択してください</option>
                  {vehicles.filter(v => v.category === otherForm.vehicle_category).map(v => (
                    <option key={v.id} value={v.id}>{v.name}{v.default_price ? `（${v.default_price.toLocaleString()}円/${v.unit}）` : ''}</option>
                  ))}
                </select>
              </div>
              {isFirstVehicleUse && (
                <div>
                  <label className="block text-sm font-medium mb-1">回送費（円・この現場でこの重機は初回のため必須）</label>
                  <input type="number" inputMode="numeric" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.mobilization_fee}
                    onChange={e => setOtherForm({ ...otherForm, mobilization_fee: e.target.value })} placeholder="0" />
                  <p className="text-xs text-gray-400 mt-1">
                    {selectedVehicle?.default_mobilization_fee != null
                      ? 'マスタに登録された回送費が入っています。この現場で違う場合はここで直してください（0なら回送費なしとして記録しません）'
                      : 'この現場でこの車両・重機を車両代に記録するのは初めてです。搬入出の回送費を入力してください（回送費がかからない車両は0）。毎回同じ額ならマスタに登録しておけます'}
                  </p>
                </div>
              )}
            </>
          )}
          {tab === 'fuel' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">種類</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => {
                    const literPrice = fuelPrices.find(fp => fp.fuel_type === '軽油')?.unit_price
                    setOtherForm(f => ({
                      ...f, fuel_type: '軽油', liter_price: literPrice ? String(literPrice) : f.liter_price,
                      unit_price: literPrice && f.quantity ? String(Math.round(literPrice * Number(f.quantity))) : f.unit_price,
                    }))
                  }}
                    className={`flex-1 py-3 rounded border text-sm font-medium ${otherForm.fuel_type === '軽油' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                    軽油
                  </button>
                  <button type="button" onClick={() => {
                    const literPrice = fuelPrices.find(fp => fp.fuel_type === 'レギュラー')?.unit_price
                    setOtherForm(f => ({
                      ...f, fuel_type: 'レギュラー', liter_price: literPrice ? String(literPrice) : f.liter_price,
                      unit_price: literPrice && f.quantity ? String(Math.round(literPrice * Number(f.quantity))) : f.unit_price,
                    }))
                  }}
                    className={`flex-1 py-3 rounded border text-sm font-medium ${otherForm.fuel_type === 'レギュラー' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                    レギュラー
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">数量（リットル）</label>
                <input type="number" step="0.01" inputMode="decimal" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.quantity}
                  onChange={e => {
                    const quantity = e.target.value
                    setOtherForm(f => ({
                      ...f, quantity,
                      unit_price: f.liter_price && quantity ? String(Math.round(Number(f.liter_price) * Number(quantity))) : f.unit_price,
                    }))
                  }} placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">単価（円/L・任意）</label>
                <input type="number" step="0.01" inputMode="decimal" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.liter_price}
                  onChange={e => {
                    const literPrice = e.target.value
                    setOtherForm(f => ({
                      ...f, liter_price: literPrice,
                      unit_price: literPrice && f.quantity ? String(Math.round(Number(literPrice) * Number(f.quantity))) : f.unit_price,
                    }))
                  }} placeholder="種類を選ぶと自動入力されます" />
                <p className="text-xs text-gray-400 mt-1">種類を選ぶと基本単価（マスタ管理で変更可）が自動入力されます。当日の単価が違う場合はここで上書きしてください</p>
                {otherForm.liter_price && otherForm.quantity && (
                  <p className="text-sm text-gray-500 mt-1">
                    金額: <span className="font-medium text-gray-800">{Math.round(Number(otherForm.liter_price) * Number(otherForm.quantity)).toLocaleString()}円</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">レシート写真から読み取る（任意）</label>
                <label className="flex items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-lg py-4 cursor-pointer hover:border-blue-400 bg-gray-50">
                  <div className="text-center">
                    <span className="text-2xl">📷</span>
                    <p className="text-sm text-gray-500 mt-1">タップして写真を選択</p>
                  </div>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setSaving(true)
                      setReceiptError(null)
                      try {
                        const { base64, mediaType } = await resizeImageToBase64(file)
                        const res = await fetch('/api/analyze-receipt', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageBase64: base64, mediaType }),
                        })
                        if (!res.ok) throw new Error('request failed')
                        const data = await res.json()
                        if (data.amount) {
                          setOtherForm(f => ({
                            ...f,
                            unit_price: String(data.amount),
                            quantity: data.liters ? String(data.liters) : f.quantity,
                            fuel_type: data.fuel_type === '軽油' || data.fuel_type === 'レギュラー' ? data.fuel_type : f.fuel_type,
                          }))
                        } else {
                          setReceiptError('金額を読み取れませんでした。金額を直接入力してください。')
                        }
                      } catch {
                        setReceiptError('読み取りに失敗しました。金額を直接入力してください。')
                      } finally {
                        setSaving(false)
                        e.target.value = ''
                      }
                    }} />
                </label>
                {saving && <p className="text-sm text-blue-500">読み取り中...</p>}
                {receiptError && <p className="text-sm text-red-500">{receiptError}</p>}
              </div>
            </>
          )}
          {tab === 'expense' && (
            <div>
              <label className="block text-sm font-medium mb-1">レシート写真から読み取る（任意）</label>
              <label className="flex items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-lg py-4 cursor-pointer hover:border-blue-400 bg-gray-50">
                <div className="text-center">
                  <span className="text-2xl">📷</span>
                  <p className="text-sm text-gray-500 mt-1">タップして写真を選択（手書きの場合は直接金額を入力してください）</p>
                </div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setSaving(true)
                    setReceiptError(null)
                    try {
                      const { base64, mediaType } = await resizeImageToBase64(file)
                      const res = await fetch('/api/analyze-expense', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageBase64: base64, mediaType }),
                      })
                      if (!res.ok) throw new Error('request failed')
                      const data = await res.json()
                      if (data.amount) {
                        setOtherForm(f => ({ ...f, unit_price: String(data.amount) }))
                      } else {
                        setReceiptError('金額を読み取れませんでした。金額を直接入力してください。')
                      }
                    } catch {
                      setReceiptError('読み取りに失敗しました。金額を直接入力してください。')
                    } finally {
                      setSaving(false)
                      e.target.value = ''
                    }
                  }} />
              </label>
              {saving && <p className="text-sm text-blue-500">読み取り中...</p>}
              {receiptError && <p className="text-sm text-red-500">{receiptError}</p>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">金額（円）</label>
            <input type="number" inputMode="numeric" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.unit_price}
              onChange={e => setOtherForm({ ...otherForm, unit_price: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">メモ（任意）</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base" value={otherForm.note}
              onChange={e => setOtherForm({ ...otherForm, note: e.target.value })} placeholder="" />
          </div>
          <button type="submit" disabled={saving || !otherForm.unit_price || (isFirstVehicleUse && !otherForm.mobilization_fee)}
            className="bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50 text-base">
            {saving ? '処理中...' : '保存する'}
          </button>
        </form>
      )}
    </div>
  )
}
