'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'
import { BillingClient, BillingEntry, deleteEntry, EntryInput, fetchClients, fetchEntries, saveEntry } from '@/lib/billing'
import { calcTotals, dailyAmount, defaultItemName, LineType, shortCompanyName } from '@/lib/billingCalc'
import { BillingMe, canEdit } from '@/lib/billingSession'

type ProjectLite = { id: number; name: string; location: string | null; status: string; deleted_at: string | null }
type Form = {
  line_type: LineType; project_id: string; client_id: string; billing_month: string
  item_name: string; amount: string; quantity: string; unit: string; unit_price: string; note: string
}
const EMPTY: Form = { line_type: 'construction', project_id: '', client_id: '', billing_month: '', item_name: '', amount: '', quantity: '', unit: '人工', unit_price: '', note: '' }
const INPUT = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'
const num = (s: string) => Number(s.replace(/[,，\s]/g, ''))
const yen = (n: number) => `${Number(n).toLocaleString()}円`
const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${y}年${mm}月` }

export default function SalesTab({ me }: { me: BillingMe }) {
  const [entries, setEntries] = useState<BillingEntry[]>([])
  const [clients, setClients] = useState<BillingClient[]>([])
  const [projects, setProjects] = useState<ProjectLite[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [editing, setEditing] = useState<BillingEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')

  async function load() {
    try {
      const [e, c, p] = await Promise.all([
        fetchEntries(), fetchClients(),
        supabase.from('projects').select('id, name, location, status, deleted_at').order('created_at', { ascending: false }),
      ])
      setEntries(e); setClients(c)
      setProjects(((p.data ?? []) as ProjectLite[]).filter(x => !x.deleted_at))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込めませんでした。')
    }
    setLoading(false)
  }
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false }
  }, [])

  const months = useMemo(() => [...new Set(entries.map(e => e.billing_month).filter((m): m is string => !!m))].sort().reverse(), [entries])
  const shown = useMemo(() => entries.filter(e => {
    if (filter === 'all') return true
    if (filter === 'unassigned') return !e.billing_month || !e.client_id
    return e.billing_month === filter
  }), [entries, filter])
  const unassigned = useMemo(() => entries.filter(e => !e.billing_month || !e.client_id).length, [entries])
  const shownTotal = calcTotals(shown).total
  const clientName = (id: number | null) => clients.find(c => c.id === id)?.name ?? '元請 未選択'
  const projectName = (id: number | null) => projects.find(p => p.id === id)?.name

  // 現場名に元請名が入っていることが多いので候補に出す。決めるのは人
  const suggestedProject = form?.project_id && !form.client_id ? projects.find(p => String(p.id) === form.project_id)?.name ?? '' : ''
  const suggestion = suggestedProject
    ? clients.find(c => c.active && shortCompanyName(c.name) && suggestedProject.includes(shortCompanyName(c.name))) ?? null
    : null

  function startNew() { setEditing(null); setForm({ ...EMPTY }); setMessage('') }
  function startEdit(e: BillingEntry) {
    setEditing(e); setMessage('')
    setForm({
      line_type: e.line_type, project_id: e.project_id ? String(e.project_id) : '', client_id: e.client_id ? String(e.client_id) : '',
      billing_month: e.billing_month ?? '', item_name: e.item_name, amount: String(e.amount),
      quantity: e.line_type === 'daily' ? String(e.quantity) : '', unit: e.line_type === 'daily' ? e.unit : '人工',
      unit_price: e.unit_price != null ? String(e.unit_price) : '', note: e.note ?? '',
    })
  }

  function pickProject(id: string) {
    if (!form) return
    const p = projects.find(x => String(x.id) === id)
    // 品名を自分で入れたあとは上書きしない
    const auto = !form.item_name || form.item_name === defaultItemName(projects.find(x => String(x.id) === form.project_id)?.location)
    setForm({ ...form, project_id: id, item_name: auto && form.line_type === 'construction' ? defaultItemName(p?.location) : form.item_name })
  }

  const dailyTotal = form && form.line_type === 'daily' && num(form.quantity) > 0 && num(form.unit_price) >= 0
    ? dailyAmount(num(form.quantity), num(form.unit_price)) : null

  async function save() {
    if (!form || busy) return
    const isDaily = form.line_type === 'daily'
    if (!form.item_name.trim()) { setMessage('品名を入れてください。'); return }
    if (isDaily) {
      if (!(num(form.quantity) > 0) || !(num(form.unit_price) >= 0) || !form.unit_price.trim()) { setMessage('数量と単価を数字で入れてください。'); return }
    } else if (!Number.isFinite(num(form.amount)) || !form.amount.trim()) { setMessage('金額（税込）を数字で入れてください。'); return }
    const values: EntryInput = {
      project_id: form.project_id ? Number(form.project_id) : null,
      client_id: form.client_id ? Number(form.client_id) : null,
      billing_month: form.billing_month || null,
      line_type: form.line_type,
      item_name: form.item_name.trim(),
      quantity: isDaily ? num(form.quantity) : 1,
      unit: isDaily ? (form.unit.trim() || '人工') : '式',
      unit_price: isDaily ? num(form.unit_price) : null,
      amount: isDaily ? dailyAmount(num(form.quantity), num(form.unit_price)) : Math.round(num(form.amount)),
      note: form.note.trim() || null,
    }
    setBusy(true); setMessage('')
    try {
      await saveEntry(editing, values, me.name)
      logAction(supabase, editing ? 'edit' : 'create', 'billing_entries', editing?.id ?? null, editing ? '売上を1件直した' : '売上を1件入れた')
      setForm(null); setEditing(null)
      await load()
      setMessage(values.billing_month && values.client_id ? '保存しました。' : '保存しました。請求月か元請が未選択なので、まだ請求書に載りません。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
    setBusy(false)
  }

  async function remove(e: BillingEntry) {
    if (!confirm('この売上を消しますか？')) return
    try {
      await deleteEntry(e)
      logAction(supabase, 'trash', 'billing_entries', e.id, '売上を1件消した')
      await load()
      setMessage('消しました。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '消せませんでした。')
    }
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div className="flex flex-col gap-3">
      {canEdit(me) && !form && (
        <button onClick={startNew} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium">＋ 売上を入れる</button>
      )}
      {message && <p className="text-sm text-blue-800 bg-blue-50 rounded-xl px-3 py-2">{message}</p>}

      {form && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
          <p className="font-bold text-sm text-gray-700">{editing ? '売上を直す' : '売上を入れる'}</p>
          <div className="flex gap-1.5">
            {([['construction', '工事代金'], ['daily', '常用工事']] as [LineType, string][]).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setForm({ ...form, line_type: key })}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition ${form.line_type === key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>{label}</button>
            ))}
          </div>
          <label className="text-sm font-medium">現場（なくても入れられます）
            <select value={form.project_id} onChange={e => pickProject(e.target.value)} className={`mt-1 ${INPUT} bg-white`}>
              <option value="">選ばない</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">元請
            <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className={`mt-1 ${INPUT} bg-white`}>
              <option value="">選ぶ</option>
              {clients.filter(c => c.active || String(c.id) === form.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {clients.length === 0 && <span className="block text-xs text-gray-500 mt-1 font-normal">「元請」のタブで先に登録してください。</span>}
          </label>
          {suggestion && (
            <button type="button" onClick={() => setForm({ ...form, client_id: String(suggestion.id) })}
              className="text-left text-sm text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-3 py-2">
              現場名から：{suggestion.name} を選ぶ
            </button>
          )}
          <label className="text-sm font-medium">請求月
            <input type="month" value={form.billing_month} onChange={e => setForm({ ...form, billing_month: e.target.value })} className={`mt-1 ${INPUT}`} />
            <span className="block text-xs text-gray-500 mt-1 font-normal">未定なら空のままで保存できます。選ぶまで請求書には載りません。</span>
          </label>
          <label className="text-sm font-medium">品名（請求書にこのまま載ります）
            <input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
              placeholder={form.line_type === 'daily' ? '例：10月常用工事' : '例：岡山市北区○○地内　工事代金'} className={`mt-1 ${INPUT}`} />
          </label>
          {form.line_type === 'construction' ? (
            <label className="text-sm font-medium">金額（税込）
              <input inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={`mt-1 ${INPUT}`} />
            </label>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-sm font-medium">数量
                <input inputMode="decimal" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className={`mt-1 ${INPUT}`} />
              </label>
              <label className="text-sm font-medium">単位
                <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className={`mt-1 ${INPUT}`} />
              </label>
              <label className="text-sm font-medium">単価（税抜）
                <input inputMode="numeric" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} className={`mt-1 ${INPUT}`} />
              </label>
              {dailyTotal !== null && <p className="col-span-3 text-xs text-gray-500">金額（税抜）：{yen(dailyTotal)}</p>}
            </div>
          )}
          <label className="text-sm font-medium">摘要（なくても可）
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={`mt-1 ${INPUT}`} />
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">{busy ? '保存中...' : '保存'}</button>
            <button onClick={() => { setForm(null); setEditing(null) }} className="flex-1 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm">やめる</button>
          </div>
        </div>
      )}

      {unassigned > 0 && (
        <button onClick={() => setFilter('unassigned')} className="text-left text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          請求月か元請が未選択の売上が {unassigned} 件あります（請求書に載りません）
        </button>
      )}

      <select value={filter} onChange={e => setFilter(e.target.value)} className={`${INPUT} bg-white`} aria-label="表示する月">
        <option value="all">すべての月</option>
        <option value="unassigned">未選択のもの</option>
        {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      {shown.length > 0 && <p className="text-sm font-bold text-gray-700 text-right">合計（税込）{yen(shownTotal)}</p>}

      {shown.length === 0 && <p className="text-sm text-gray-500 text-center py-6">まだ売上がありません。{canEdit(me) ? '「売上を入れる」から始めてください。' : ''}</p>}
      <div className="flex flex-col gap-2">
        {shown.map(e => (
          <div key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">{e.item_name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{clientName(e.client_id)}・{e.billing_month ? monthLabel(e.billing_month) : <span className="text-amber-700">請求月 未選択</span>}</p>
                {projectName(e.project_id) && <p className="text-xs text-gray-400 mt-0.5">現場：{projectName(e.project_id)}</p>}
              </div>
              <p className="text-sm font-bold shrink-0 text-right">
                {yen(e.amount)}
                <span className="block text-[11px] font-normal text-gray-500">{e.line_type === 'construction' ? '税込' : `税抜 ${e.quantity}${e.unit}`}</span>
              </p>
            </div>
            {canEdit(me) && (
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => startEdit(e)} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">直す</button>
                <button onClick={() => remove(e)} className="text-xs text-red-600 border border-gray-200 rounded-lg px-3 py-1.5">消す</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
