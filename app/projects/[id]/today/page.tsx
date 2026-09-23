'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase, WasteType } from '@/lib/supabase'
import { jstToday, jstDateOffset } from '@/lib/date'
import { isOffline, isNetworkError, enqueue } from '@/lib/offlineQueue'
import { loadGate, gateOpen, GateState } from '@/lib/morningGate'
import { logAction } from '@/lib/audit'
import MorningGateBlock from '../MorningGateBlock'

// 夕方の「今日の記入」。人工・廃材・経費を1画面に縦に並べ、最後に1回だけ保存する。
// 入力の7割が17時台に集中しているので、ここを速くするのが一番効く（2026-09）。
// 燃料代（リットル計算）・車両代（回送費）・レシートの読み取り・音声は「くわしく入力」に残してある。

const LABOR_UNIT_PRICE = Math.round(15000 * 1.1)   // entry 画面と同じ単価
const LABOR_UNIT_PRICE_HALF = Math.round(LABOR_UNIT_PRICE / 2)
type DayType = 'full' | 'half'
type WT = WasteType & { disposal_sites?: { name: string } }

// 数量の＋−の幅。トン・立米は0.5、キロは10、それ以外は1
const stepOf = (unit: string) => (/^(t|m3|㎥|立米)$/i.test(unit) ? 0.5 : unit === 'kg' ? 10 : 1)
const yen = (n: number) => `${n.toLocaleString()}円`

export default function TodayEntryPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const router = useRouter()
  const [date, setDate] = useState(jstToday())
  const [projectName, setProjectName] = useState('')
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([])
  const [recentWorkerIds, setRecentWorkerIds] = useState<number[]>([])
  const [wasteTypes, setWasteTypes] = useState<WT[]>([])
  const [recentTypeIds, setRecentTypeIds] = useState<number[]>([])
  const [laborDone, setLaborDone] = useState<Record<number, DayType>>({})
  const [gate, setGate] = useState<GateState | null>(null)
  const [loading, setLoading] = useState(true)

  // 入力中の内容
  const [labor, setLabor] = useState<Record<number, DayType>>({})
  const [showAllWorkers, setShowAllWorkers] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [extraTypeIds, setExtraTypeIds] = useState<number[]>([])
  const [expense, setExpense] = useState({ amount: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const since = jstDateOffset(-30)
      const [{ data: pj }, { data: wk }, { data: recentLabor }, { data: wt }, { data: recentWaste }] = await Promise.all([
        supabase.from('projects').select('name').eq('id', projectId).limit(1),
        supabase.from('workers').select('*').order('name'),
        supabase.from('labor_entries').select('worker_id, date').eq('project_id', projectId).gte('date', since),
        supabase.from('waste_types').select('*, disposal_sites(name)').order('name'),
        supabase.from('waste_entries').select('waste_type_id').eq('project_id', projectId).order('date', { ascending: false }).limit(200),
      ])
      if (cancelled) return
      setProjectName((pj?.[0] as { name?: string } | undefined)?.name ?? '')
      // 段取りから外した人（退職者など）は出さない
      setWorkers(((wk ?? []) as { id: number; name: string; in_dispatch?: boolean }[]).filter(w => w.in_dispatch !== false))
      const freq = (ids: number[]) => {
        const c = new Map<number, number>()
        ids.forEach(i => c.set(i, (c.get(i) ?? 0) + 1))
        return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i)
      }
      setRecentWorkerIds(freq(((recentLabor ?? []) as { worker_id: number }[]).map(r => r.worker_id)))
      const types = ((wt ?? []) as WT[]).filter(t => t.entry_type !== 'revenue')
      setWasteTypes(types)
      const rt = freq(((recentWaste ?? []) as { waste_type_id: number }[]).map(r => r.waste_type_id)).filter(i => types.some(t => t.id === i))
      setRecentTypeIds(rt.slice(0, 4))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId])

  // 日付ごとに：その日すでに入っている人工と、朝の KY・議事録・道具の確認
  async function refreshDay(d: string) {
    const [{ data }, g] = await Promise.all([
      supabase.from('labor_entries').select('worker_id, day_type').eq('project_id', projectId).eq('date', d),
      loadGate(supabase, projectId, d),
    ])
    const map: Record<number, DayType> = {}
    ;((data ?? []) as { worker_id: number; day_type?: DayType }[]).forEach(r => { map[r.worker_id] = r.day_type ?? 'full' })
    setLaborDone(map)
    setGate(g)
  }
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('labor_entries').select('worker_id, day_type').eq('project_id', projectId).eq('date', date),
      loadGate(supabase, projectId, date),
    ]).then(([{ data }, g]) => {
      if (cancelled) return
      const map: Record<number, DayType> = {}
      ;((data ?? []) as { worker_id: number; day_type?: DayType }[]).forEach(r => { map[r.worker_id] = r.day_type ?? 'full' })
      setLaborDone(map)
      setGate(g)
    })
    return () => { cancelled = true }
  }, [projectId, date])

  // 人工の並び：この現場に最近来た人が先。「ほかの人」で全員
  const crew = useMemo(() => {
    const byId = new Map(workers.map(w => [w.id, w]))
    const recent = recentWorkerIds.map(i => byId.get(i)).filter(Boolean) as { id: number; name: string }[]
    const rest = workers.filter(w => !recentWorkerIds.includes(w.id))
    const picked = rest.filter(w => w.id in labor || w.id in laborDone)
    return showAllWorkers || recent.length === 0 ? [...recent, ...rest] : [...recent.slice(0, 10), ...picked]
  }, [workers, recentWorkerIds, showAllWorkers, labor, laborDone])

  const typeRows = useMemo(() => {
    const ids = [...(recentTypeIds.length ? recentTypeIds : wasteTypes.slice(0, 3).map(t => t.id)), ...extraTypeIds.filter(i => !recentTypeIds.includes(i))]
    return ids.map(i => wasteTypes.find(t => t.id === i)).filter(Boolean) as WT[]
  }, [recentTypeIds, extraTypeIds, wasteTypes])

  function cycle(workerId: number) {
    if (workerId in laborDone) return
    setLabor(prev => {
      const next = { ...prev }
      if (!(workerId in prev)) next[workerId] = 'full'
      else if (prev[workerId] === 'full') next[workerId] = 'half'
      else delete next[workerId]
      return next
    })
  }

  function bump(t: WT, dir: 1 | -1) {
    const step = stepOf(t.unit)
    setQty(prev => {
      const cur = Number(prev[t.id] || 0)
      const v = Math.max(0, Math.round((cur + dir * step) * 1000) / 1000)
      return { ...prev, [t.id]: v ? String(v) : '' }
    })
  }

  const open = gate ? gateOpen(gate) : false
  const laborRows = open ? Object.entries(labor).filter(([w]) => !(Number(w) in laborDone)) : []
  const wasteRows = open ? typeRows.filter(t => Number(qty[t.id]) > 0) : []
  const expenseAmount = Number(expense.amount) || 0
  const laborTotal = laborRows.reduce((s, [, d]) => s + (d === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE), 0)
  const wasteTotal = wasteRows.reduce((s, t) => s + Math.round(t.unit_price * Number(qty[t.id])), 0)
  const count = (laborRows.length ? 1 : 0) + wasteRows.length + (expenseAmount > 0 ? 1 : 0)
  const total = laborTotal + wasteTotal + expenseAmount

  // 保存。圏外なら端末に貯める（くわしく入力と同じ）
  async function put(table: string, rows: Record<string, unknown>[], label: string): Promise<'sent' | 'queued' | 'error'> {
    if (isOffline()) { enqueue(table, rows, label); return 'queued' }
    const { error } = await supabase.from(table).insert(rows)
    if (!error) return 'sent'
    if (isNetworkError(error)) { enqueue(table, rows, label); return 'queued' }
    return 'error'
  }

  async function save() {
    if (!count || saving) return
    setSaving(true); setMessage(null)
    const md = date.slice(5).replace('-', '/')
    const results: ('sent' | 'queued' | 'error')[] = []

    if (laborRows.length || wasteRows.length) {
      // 押す直前にもう一度、朝の分と、同じ日の人工を確かめる（別の端末で入れた分を重ねない）
      const g = await loadGate(supabase, projectId, date)
      if (!gateOpen(g)) { setGate(g); setSaving(false); return }
    }
    if (laborRows.length) {
      let already = new Set(Object.keys(laborDone).map(Number))
      if (!isOffline()) {
        const { data } = await supabase.from('labor_entries').select('worker_id').eq('project_id', projectId).eq('date', date)
        if (data) already = new Set((data as { worker_id: number }[]).map(r => r.worker_id))
      }
      const rows = laborRows.filter(([w]) => !already.has(Number(w))).map(([w, d]) => ({
        project_id: projectId, worker_id: Number(w), date, day_type: d,
        amount: d === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE,
      }))
      if (rows.length) results.push(await put('labor_entries', rows, `${projectName} 人工 ${rows.length}名（${md}）`))
    }
    for (const t of wasteRows) {
      const q = Number(qty[t.id])
      results.push(await put('waste_entries', [{
        project_id: projectId, waste_type_id: t.id, date, quantity: q, amount: Math.round(t.unit_price * q),
      }], `${projectName} 廃材 ${t.name} ${q}${t.unit}（${md}）`))
    }
    if (expenseAmount > 0) {
      results.push(await put('other_entries', [{
        project_id: projectId, entry_type: 'expense', date, quantity: 1, unit_price: expenseAmount, amount: expenseAmount,
        note: expense.note.trim() || null, fuel_type: null, vehicle_id: null,
      }], `${projectName} 経費 ${yen(expenseAmount)}（${md}）`))
    }
    setSaving(false)

    if (results.includes('error')) {
      setMessage({ tone: 'bad', text: '一部を保存できませんでした。現場詳細の記録一覧で確かめて、足りない分をもう一度入れてください。' })
    } else if (results.includes('queued')) {
      setMessage({ tone: 'warn', text: '圏外なので端末に貯めました。つながったら自動で送ります ✓' })
    } else {
      setMessage({ tone: 'ok', text: `保存しました ✓　${yen(total)}` })
      logAction(supabase, 'create', 'labor_entries', null, `${projectName} の今日の記入（${md}）：${count}件 ${yen(total)}`)
    }
    if (!results.includes('error')) {
      setLabor({}); setQty({}); setExpense({ amount: '', note: '' })
    }
    await refreshDay(date)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const doneNames = Object.entries(laborDone).map(([w, d]) => `${workers.find(x => x.id === Number(w))?.name ?? ''}${d === 'half' ? '（半日）' : ''}`)
  const addable = wasteTypes.filter(t => !typeRows.some(r => r.id === t.id))

  return (
    <div className="flex flex-col gap-3 pb-24">
      <button onClick={() => router.back()} className="text-blue-600 text-sm self-start py-1">← 戻る</button>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{projectName}</p>
          <h1 className="text-xl font-bold">今日の記入</h1>
        </div>
        <input id="today-date" type="date" aria-label="日付" value={date} max={jstToday()}
          onChange={e => { setDate(e.target.value); setLabor({}); setMessage(null) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white shrink-0" />
      </div>

      {message && (
        <div className={`rounded-xl px-3 py-2 text-sm font-medium border ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : message.tone === 'warn' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
          {message.text}
        </div>
      )}

      {!gate && <p className="text-center py-6 text-gray-500 text-sm">朝の KY活動・議事録・道具の確認を確かめています...</p>}

      {gate && !open && (
        <MorningGateBlock projectId={projectId} projectName={projectName} gate={gate} date={date}
          onDateChange={d => { setDate(d); setLabor({}) }} onUnlocked={() => refreshDay(date)} />
      )}

      {gate && open && (
        <>
          <section className="bg-white rounded-2xl border border-gray-100 p-3" aria-labelledby="sec-labor">
            <div className="flex justify-between items-baseline">
              <h2 id="sec-labor" className="text-sm font-bold text-gray-700">人工</h2>
              <span className="text-[11px] text-gray-500">押すたびに 全日 → 半日 → 外す</span>
            </div>
            {doneNames.length > 0 && <p className="text-xs text-emerald-700 mt-1">この日は登録済み：{doneNames.join('、')}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {crew.map(w => {
                const done = w.id in laborDone
                const st = labor[w.id]
                return (
                  <button key={w.id} type="button" onClick={() => cycle(w.id)} disabled={done}
                    className={`min-h-11 px-3 rounded-xl text-sm font-bold border transition ${done ? 'bg-emerald-50 border-transparent text-emerald-700' : st === 'full' ? 'bg-blue-900 border-blue-900 text-white' : st === 'half' ? 'bg-white border-blue-900 text-blue-900' : 'bg-white border-gray-200 text-gray-800'}`}>
                    {w.name}{done ? ' ✓' : st === 'full' ? '　全日' : st === 'half' ? '　半日' : ''}
                  </button>
                )
              })}
              {!showAllWorkers && workers.length > crew.length && (
                <button type="button" onClick={() => setShowAllWorkers(true)}
                  className="min-h-11 px-3 rounded-xl text-sm font-bold border border-dashed border-gray-300 text-gray-600">＋ ほかの人</button>
              )}
            </div>
            {laborRows.length > 0 && (
              <p className="text-xs text-gray-600 mt-2 flex justify-between">
                <span>{laborRows.reduce((s, [, d]) => s + (d === 'half' ? 0.5 : 1), 0)}人工</span>
                <span className="font-mono font-bold">{yen(laborTotal)}</span>
              </p>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 p-3" aria-labelledby="sec-waste">
            <h2 id="sec-waste" className="text-sm font-bold text-gray-700">廃材（処分代）<span className="text-[11px] font-normal text-gray-500 ml-2">この現場でよく出る種類</span></h2>
            <div className="flex flex-col divide-y divide-gray-100 mt-1">
              {typeRows.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{t.disposal_sites?.name ?? ''}　{t.unit_price.toLocaleString()}円/{t.unit}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => bump(t, -1)} aria-label={`${t.name}を減らす`}
                      className="w-10 h-10 rounded-xl border border-gray-200 text-lg font-bold text-blue-900">−</button>
                    <input id={`qty-${t.id}`} inputMode="decimal" aria-label={`${t.name}の数量（${t.unit}）`}
                      className="w-16 text-center border border-gray-200 rounded-lg py-2 text-base font-mono"
                      value={qty[t.id] ?? ''} placeholder="0" onChange={e => setQty(prev => ({ ...prev, [t.id]: e.target.value.replace(/[^0-9.]/g, '') }))} />
                    <button type="button" onClick={() => bump(t, 1)} aria-label={`${t.name}を増やす`}
                      className="w-10 h-10 rounded-xl border border-gray-200 text-lg font-bold text-blue-900">＋</button>
                  </div>
                </div>
              ))}
            </div>
            {addable.length > 0 && (
              <select id="add-waste-type" aria-label="ほかの種類を足す" value=""
                onChange={e => e.target.value && setExtraTypeIds(prev => [...prev, Number(e.target.value)])}
                className="w-full border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 mt-1">
                <option value="">＋ ほかの種類を足す</option>
                {addable.map(t => <option key={t.id} value={t.id}>{t.name}（{t.disposal_sites?.name ?? ''}・{t.unit_price.toLocaleString()}円/{t.unit}）</option>)}
              </select>
            )}
            {wasteRows.length > 0 && (
              <p className="text-xs text-gray-600 mt-2 flex justify-between"><span>{wasteRows.length}種類</span><span className="font-mono font-bold">{yen(wasteTotal)}</span></p>
            )}
          </section>
        </>
      )}

      <section className="bg-white rounded-2xl border border-gray-100 p-3" aria-labelledby="sec-expense">
        <h2 id="sec-expense" className="text-sm font-bold text-gray-700">経費</h2>
        <div className="flex gap-2 mt-2">
          <input id="expense-note" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2.5 text-base" placeholder="内容（例：ガソリン）"
            value={expense.note} onChange={e => setExpense({ ...expense, note: e.target.value })} />
          <input id="expense-amount" inputMode="numeric" className="w-28 border border-gray-200 rounded-lg px-3 py-2.5 text-base text-right font-mono" placeholder="円"
            value={expense.amount} onChange={e => setExpense({ ...expense, amount: e.target.value.replace(/[^0-9]/g, '') })} />
        </div>
        <Link href={`/projects/${projectId}/entry`} className="block text-xs text-blue-700 underline mt-2">
          燃料代・車両代・レシートの読み取り・音声で入れる → くわしく入力
        </Link>
      </section>

      <div className="fixed left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] px-4 z-30">
        <div className="max-w-2xl mx-auto">
          <button onClick={save} disabled={!count || saving}
            className="w-full min-h-14 rounded-2xl bg-blue-900 text-white text-base font-bold shadow-lg disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none">
            {saving ? '保存中...' : count ? `${count}件まとめて保存　${yen(total)}` : '入れるものを選んでください'}
          </button>
        </div>
      </div>
    </div>
  )
}
