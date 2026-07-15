'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase, Project, WasteEntry, OtherEntry, DisposalSite, WasteType } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type SortDir = 'asc' | 'desc'
type DeleteTarget = { table: 'waste_entries' | 'other_entries' | 'labor_entries'; id: number; label: string }
type Worker = { id: number; name: string; company_name: string | null }

const LABOR_UNIT_PRICE_TAX_EXCL = 15000
const LABOR_UNIT_PRICE = Math.round(LABOR_UNIT_PRICE_TAX_EXCL * 1.1)
const LABOR_UNIT_PRICE_HALF = Math.round(LABOR_UNIT_PRICE / 2)

type EditTarget =
  | { type: 'waste'; id: number; date: string; site_id: string; waste_type_id: string; quantity: string }
  | { type: 'labor'; id: number; date: string; worker_id: string; day_type: 'full' | 'half' }
  | { type: 'other'; id: number; entry_type: 'fuel' | 'lease' | 'expense'; date: string; unit_price: string; quantity: string; fuel_type: '' | '軽油' | 'レギュラー'; note: string }

function CostBar({ label, amount, max, color }: { label: string; amount: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-medium">{amount.toLocaleString()}円</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [wasteEntries, setWasteEntries] = useState<WasteEntry[]>([])
  const [otherEntries, setOtherEntries] = useState<OtherEntry[]>([])
  const [laborEntries, setLaborEntries] = useState<any[]>([])
  const [scrapRecords, setScrapRecords] = useState<{ date: string; items: string | null; note: string | null; amount: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sites, setSites] = useState<DisposalSite[]>([])
  const [wasteTypes, setWasteTypes] = useState<WasteType[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [showChart, setShowChart] = useState(true)
  const [editNotes, setEditNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [uploadingAerial, setUploadingAerial] = useState(false)
  const [showAerial, setShowAerial] = useState(false)
  const aerialInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: p }, { data: we }, { data: oe }, { data: le }, { data: sr }, { data: s }, { data: wt }, { data: wk }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('waste_entries').select('*, waste_types(name, unit, unit_price, entry_type, disposal_site_id, disposal_sites(name))').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('other_entries').select('*').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('labor_entries').select('*, workers(name, company_name)').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('scrap_records').select('date, items, note, amount').eq('project_id', id),
      supabase.from('disposal_sites').select('*').order('name'),
      supabase.from('waste_types').select('*').order('name'),
      supabase.from('workers').select('*').order('name'),
    ])
    setProject(p)
    setNotesValue(p?.notes ?? '')
    setWasteEntries((we as any) ?? [])
    setOtherEntries((oe as any) ?? [])
    setLaborEntries((le as any) ?? [])
    setScrapRecords(sr ?? [])
    setSites(s ?? [])
    setWasteTypes((wt as any) ?? [])
    setWorkers(wk ?? [])
    setLoading(false)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    await supabase.from(deleteTarget.table).delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    setDeleting(false)
    load()
  }

  function openEditWaste(e: any) {
    setEditTarget({
      type: 'waste', id: e.id, date: e.date,
      site_id: String(e.waste_types?.disposal_site_id ?? ''),
      waste_type_id: String(e.waste_type_id),
      quantity: String(e.quantity),
    })
  }

  function openEditLabor(e: any) {
    setEditTarget({ type: 'labor', id: e.id, date: e.date, worker_id: String(e.worker_id), day_type: e.day_type })
  }

  function openEditOther(e: OtherEntry) {
    setEditTarget({
      type: 'other', id: e.id, entry_type: e.entry_type as 'fuel' | 'lease' | 'expense', date: e.date,
      unit_price: String(e.amount),
      quantity: e.entry_type === 'fuel' && Number(e.quantity) ? String(e.quantity) : '',
      fuel_type: (e.fuel_type === '軽油' || e.fuel_type === 'レギュラー') ? e.fuel_type : '',
      note: e.note ?? '',
    })
  }

  async function saveEdit() {
    if (!editTarget) return
    setEditSaving(true)
    if (editTarget.type === 'waste') {
      const wt = wasteTypes.find(w => String(w.id) === editTarget.waste_type_id)
      const amount = wt ? Math.round(wt.unit_price * Number(editTarget.quantity)) : 0
      await supabase.from('waste_entries').update({
        waste_type_id: Number(editTarget.waste_type_id),
        date: editTarget.date,
        quantity: Number(editTarget.quantity),
        amount,
      }).eq('id', editTarget.id)
    } else if (editTarget.type === 'labor') {
      const amount = editTarget.day_type === 'half' ? LABOR_UNIT_PRICE_HALF : LABOR_UNIT_PRICE
      await supabase.from('labor_entries').update({
        worker_id: Number(editTarget.worker_id),
        date: editTarget.date,
        day_type: editTarget.day_type,
        amount,
      }).eq('id', editTarget.id)
    } else {
      const amount = Number(editTarget.unit_price)
      await supabase.from('other_entries').update({
        date: editTarget.date,
        quantity: editTarget.entry_type === 'fuel' && editTarget.quantity ? Number(editTarget.quantity) : 1,
        unit_price: amount,
        amount,
        note: editTarget.note || null,
        fuel_type: editTarget.entry_type === 'fuel' ? (editTarget.fuel_type || null) : null,
      }).eq('id', editTarget.id)
    }
    setEditSaving(false)
    setEditTarget(null)
    load()
  }

  async function saveNotes() {
    await supabase.from('projects').update({ notes: notesValue || null }).eq('id', id)
    setEditNotes(false)
    load()
  }

  async function handleAerialUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAerial(true)
    const ext = file.name.split('.').pop()
    const path = `aerial/${id}/aerial.${ext}`
    await supabase.storage.from('project-files').upload(path, file, { upsert: true })
    const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
    await supabase.from('projects').update({ aerial_photo_url: urlData.publicUrl }).eq('id', id)
    setUploadingAerial(false)
    load()
    if (aerialInputRef.current) aerialInputRef.current.value = ''
  }

  async function toggleStatus() {
    if (!project) return
    const newStatus = project.status === 'active' ? 'completed' : 'active'
    await supabase.from('projects').update({ status: newStatus }).eq('id', id)
    load()
  }

  function downloadCSV() {
    const rows: string[][] = [['日付', '種別', '処分場', '廃材名・内容', '数量', '単位', '金額（円）']]

    sortedWaste.forEach((e: any) => {
      rows.push([
        e.date,
        e.waste_types?.entry_type === 'revenue' ? 'スクラップ収益' : '廃材処分費',
        e.waste_types?.disposal_sites?.name ?? '',
        e.waste_types?.name ?? '',
        String(e.quantity),
        e.waste_types?.unit ?? '',
        String(e.amount),
      ])
    })

    sortedLabor.forEach((e: any) => {
      const label = e.day_type === 'half' ? '人工費（半日）' : '人工費'
      rows.push([e.date, label, '', e.workers?.name ?? '', '1', '人', String(e.amount)])
    })

    sortedOther.forEach((e: any) => {
      const label = e.entry_type === 'fuel' ? `燃料代${e.fuel_type ? `（${e.fuel_type}）` : ''}`
        : e.entry_type === 'expense' ? '経費'
        : 'リース代'
      const isFuelWithLiters = e.entry_type === 'fuel' && Number(e.quantity) > 0 && Number(e.quantity) !== 1
      rows.push([
        e.date, label, '', e.note ?? '',
        isFuelWithLiters ? String(e.quantity) : '1',
        isFuelWithLiters ? 'リットル' : '式',
        String(e.amount),
      ])
    })

    scrapRecords.forEach((r) => {
      let itemLabel = ''
      try { itemLabel = r.items ? JSON.parse(r.items).map((i: any) => i.name).join('・') : (r.items ?? '') }
      catch { itemLabel = r.items ?? '' }
      rows.push([r.date, 'スクラップ収益', '', itemLabel || r.note || '', '1', '式', String(r.amount)])
    })

    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const bom = '﻿'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.name ?? '現場'}_台帳.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP') + '円'

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!project) return <p className="text-center py-10 text-gray-500">現場が見つかりません</p>

  const wasteCost = wasteEntries.filter((e: any) => e.waste_types?.entry_type === 'cost').reduce((s, e) => s + Number(e.amount), 0)
  const scrapRevenue = wasteEntries.filter((e: any) => e.waste_types?.entry_type === 'revenue').reduce((s, e) => s + Number(e.amount), 0)
    + scrapRecords.reduce((s, r) => s + Number(r.amount), 0)
  const laborAmt = laborEntries.reduce((s, e) => s + Number(e.amount), 0) + otherEntries.filter(e => e.entry_type === 'labor').reduce((s, e) => s + Number(e.amount), 0)
  const fuelAmt = otherEntries.filter(e => e.entry_type === 'fuel').reduce((s, e) => s + Number(e.amount), 0)
  const leaseAmt = otherEntries.filter(e => e.entry_type === 'lease').reduce((s, e) => s + Number(e.amount), 0)
  const expenseAmt = otherEntries.filter(e => e.entry_type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
  const totalCost = wasteCost + laborAmt + fuelAmt + leaseAmt + expenseAmt
  const profit = scrapRevenue - totalCost
  const isProfit = profit >= 0
  const maxBar = Math.max(wasteCost, laborAmt, fuelAmt, leaseAmt, expenseAmt, scrapRevenue, 1)

  const sortFn = (a: any, b: any) =>
    sortDir === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)

  const sortedWaste = [...wasteEntries].sort(sortFn)
  const sortedLabor = [...laborEntries].sort(sortFn)
  const sortedOther = [...otherEntries].sort(sortFn)

  const otherLabel: Record<string, string> = { labor: '人工', fuel: '燃料代', lease: 'リース代', expense: '経費' }

  return (
    <div>
      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">削除の確認</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-medium text-gray-900">{deleteTarget.label}</span> を削除しますか？<br />
              この操作は元に戻せません。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border rounded-lg text-gray-600 font-medium">
                キャンセル
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">記録を編集</h3>

            {editTarget.type === 'waste' && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">日付</label>
                  <input type="date" className="w-full border rounded px-3 py-2 text-base" value={editTarget.date}
                    onChange={e => setEditTarget({ ...editTarget, date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">処分場</label>
                  <select className="w-full border rounded px-3 py-2 text-base" value={editTarget.site_id}
                    onChange={e => setEditTarget({ ...editTarget, site_id: e.target.value, waste_type_id: '' })}>
                    <option value="">選択してください</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">廃材種類</label>
                  <select className="w-full border rounded px-3 py-2 text-base" value={editTarget.waste_type_id}
                    onChange={e => setEditTarget({ ...editTarget, waste_type_id: e.target.value })}
                    disabled={!editTarget.site_id}>
                    <option value="">選択してください</option>
                    {wasteTypes.filter(w => String(w.disposal_site_id) === editTarget.site_id).map(w => (
                      <option key={w.id} value={w.id}>{w.name}（{w.unit_price.toLocaleString()}円/{w.unit}）</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">数量</label>
                  <input type="number" step="0.001" inputMode="decimal" className="w-full border rounded px-3 py-2 text-base"
                    value={editTarget.quantity} onChange={e => setEditTarget({ ...editTarget, quantity: e.target.value })} />
                </div>
              </div>
            )}

            {editTarget.type === 'labor' && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">日付</label>
                  <input type="date" className="w-full border rounded px-3 py-2 text-base" value={editTarget.date}
                    onChange={e => setEditTarget({ ...editTarget, date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">作業員</label>
                  <select className="w-full border rounded px-3 py-2 text-base" value={editTarget.worker_id}
                    onChange={e => setEditTarget({ ...editTarget, worker_id: e.target.value })}>
                    {workers.map(w => <option key={w.id} value={w.id}>{w.name}{w.company_name ? `（${w.company_name}）` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">出勤区分</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditTarget({ ...editTarget, day_type: 'full' })}
                      className={`flex-1 py-2 rounded border text-sm font-medium ${editTarget.day_type === 'full' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                      1日
                    </button>
                    <button type="button" onClick={() => setEditTarget({ ...editTarget, day_type: 'half' })}
                      className={`flex-1 py-2 rounded border text-sm font-medium ${editTarget.day_type === 'half' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                      半日
                    </button>
                  </div>
                </div>
              </div>
            )}

            {editTarget.type === 'other' && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">日付</label>
                  <input type="date" className="w-full border rounded px-3 py-2 text-base" value={editTarget.date}
                    onChange={e => setEditTarget({ ...editTarget, date: e.target.value })} />
                </div>
                {editTarget.entry_type === 'fuel' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">種類</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditTarget({ ...editTarget, fuel_type: '軽油' })}
                          className={`flex-1 py-2 rounded border text-sm font-medium ${editTarget.fuel_type === '軽油' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                          軽油
                        </button>
                        <button type="button" onClick={() => setEditTarget({ ...editTarget, fuel_type: 'レギュラー' })}
                          className={`flex-1 py-2 rounded border text-sm font-medium ${editTarget.fuel_type === 'レギュラー' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                          レギュラー
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">数量（リットル）</label>
                      <input type="number" step="0.01" inputMode="decimal" className="w-full border rounded px-3 py-2 text-base"
                        value={editTarget.quantity} onChange={e => setEditTarget({ ...editTarget, quantity: e.target.value })} />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">金額（円）</label>
                  <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-2 text-base"
                    value={editTarget.unit_price} onChange={e => setEditTarget({ ...editTarget, unit_price: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">メモ（任意）</label>
                  <input className="w-full border rounded px-3 py-2 text-base"
                    value={editTarget.note} onChange={e => setEditTarget({ ...editTarget, note: e.target.value })} />
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 py-2 border rounded-lg text-gray-600 font-medium">
                キャンセル
              </button>
              <button onClick={saveEdit} disabled={editSaving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
                {editSaving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => router.push('/')} className="text-blue-600 text-sm mb-3 py-1">← 現場一覧</button>

      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-xl font-bold">{project.name}</h1>
          <p className="text-sm text-gray-500">{project.start_date} 〜 {project.end_date ?? '進行中'}</p>
          {project.location && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-1"
            >
              📍 {project.location}
            </a>
          )}
        </div>
        <Link href={`/projects/${id}/entry`} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0">
          + 入力
        </Link>
      </div>

      {/* ステータス・操作ボタン */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${project.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {project.status === 'active' ? '進行中' : '完了'}
        </span>
        <button onClick={toggleStatus}
          className="text-xs px-3 py-1.5 rounded-full border text-gray-600 bg-white">
          {project.status === 'active' ? '完了にする' : '進行中に戻す'}
        </button>
        <button onClick={downloadCSV}
          className="text-xs px-3 py-1.5 rounded-full border text-blue-600 bg-white ml-auto">
          CSV出力
        </button>
      </div>

      {/* ナビゲーション */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Link href={`/projects/${id}/plan`}
          className="bg-white rounded-lg shadow p-3 flex flex-col items-center gap-1 hover:shadow-md transition active:scale-[0.98]">
          <span className="text-2xl">📊</span>
          <span className="font-medium text-xs text-gray-700">予算・工程</span>
          <span className="text-xs text-gray-400">計画管理</span>
        </Link>
        <Link href={`/projects/${id}/scrap`}
          className="bg-white rounded-lg shadow p-3 flex flex-col items-center gap-1 hover:shadow-md transition active:scale-[0.98]">
          <span className="text-2xl">♻️</span>
          <span className="font-medium text-xs text-gray-700">スクラップ</span>
          <span className="text-xs text-gray-400">写真・伝票記録</span>
        </Link>
        <Link href={`/projects/${id}/minutes`}
          className="bg-white rounded-lg shadow p-3 flex flex-col items-center gap-1 hover:shadow-md transition active:scale-[0.98]">
          <span className="text-2xl">📋</span>
          <span className="font-medium text-xs text-gray-700">議事録</span>
          <span className="text-xs text-gray-400">危険箇所・注意事項</span>
        </Link>
        <Link href={`/projects/${id}/ky`}
          className="bg-white rounded-lg shadow p-3 flex flex-col items-center gap-1 hover:shadow-md transition active:scale-[0.98]">
          <span className="text-2xl">🛡️</span>
          <span className="font-medium text-xs text-gray-700">KY活動</span>
          <span className="text-xs text-gray-400">写真記録</span>
        </Link>
      </div>

      {/* 上空図面 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold text-gray-700 text-sm">上空図面</h2>
          <div className="flex gap-2">
            {project.aerial_photo_url && (
              <button onClick={() => setShowAerial(v => !v)} className="text-xs text-blue-600">
                {showAerial ? '閉じる' : '表示'}
              </button>
            )}
            <label className={`text-xs px-2 py-1 rounded border cursor-pointer ${uploadingAerial ? 'text-gray-400' : 'text-blue-600'}`}>
              {uploadingAerial ? 'アップロード中...' : project.aerial_photo_url ? '差し替え' : 'アップロード'}
              <input ref={aerialInputRef} type="file" accept="image/*" className="hidden"
                disabled={uploadingAerial} onChange={handleAerialUpload} />
            </label>
          </div>
        </div>
        {!project.aerial_photo_url && (
          <p className="text-sm text-gray-400">図面がありません</p>
        )}
        {project.aerial_photo_url && showAerial && (
          <img src={project.aerial_photo_url} alt="上空図面"
            className="w-full rounded border mt-1" />
        )}
        {project.aerial_photo_url && !showAerial && (
          <p className="text-sm text-gray-500">図面あり（「表示」で確認）</p>
        )}
      </div>

      {/* 備考欄 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex justify-between items-center mb-1">
          <h2 className="font-bold text-gray-700 text-sm">備考・メモ</h2>
          {!editNotes && (
            <button onClick={() => setEditNotes(true)} className="text-xs text-blue-600">編集</button>
          )}
        </div>
        {editNotes ? (
          <div className="flex flex-col gap-2">
            <textarea
              className="w-full border rounded px-3 py-2 text-sm resize-none"
              rows={3}
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              placeholder="特記事項、担当者名など"
            />
            <div className="flex gap-2">
              <button onClick={() => { setEditNotes(false); setNotesValue(project.notes ?? '') }}
                className="flex-1 py-1.5 border rounded text-sm text-gray-600">キャンセル</button>
              <button onClick={saveNotes}
                className="flex-1 py-1.5 bg-blue-600 text-white rounded text-sm">保存</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {project.notes || <span className="text-gray-400">なし（タップして追加）</span>}
          </p>
        )}
      </div>

      {/* 集計カード */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-gray-700">集計</h2>
          <button onClick={() => setShowChart(v => !v)} className="text-xs text-blue-600">
            {showChart ? 'グラフを隠す' : 'グラフを表示'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 text-sm">
          <div className="text-gray-600">廃材処分費</div><div className="text-right font-medium text-red-600">{fmt(wasteCost)}</div>
          <div className="text-gray-600">スクラップ収益</div><div className="text-right font-medium text-blue-600">{fmt(scrapRevenue)}</div>
          <div className="text-gray-600">人工費</div><div className="text-right">{fmt(laborAmt)}</div>
          <div className="text-gray-600">燃料代</div><div className="text-right">{fmt(fuelAmt)}</div>
          <div className="text-gray-600">リース代</div><div className="text-right">{fmt(leaseAmt)}</div>
          <div className="text-gray-600">経費</div><div className="text-right">{fmt(expenseAmt)}</div>
          <div className="font-bold border-t pt-1 mt-1">支出合計</div>
          <div className="text-right font-bold border-t pt-1 mt-1 text-red-700">{fmt(totalCost)}</div>
        </div>

        {/* 損益 */}
        <div className={`mt-3 rounded-lg px-3 py-2 flex justify-between items-center ${isProfit ? 'bg-blue-50' : 'bg-red-50'}`}>
          <span className="font-bold text-gray-700">差引損益</span>
          <span className={`font-bold text-lg ${isProfit ? 'text-blue-700' : 'text-red-700'}`}>
            {isProfit ? '+' : ''}{fmt(profit)}
          </span>
        </div>

        {/* グラフ */}
        {showChart && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs text-gray-500 mb-3">費用内訳</p>
            <CostBar label="廃材処分費" amount={wasteCost} max={maxBar} color="bg-red-400" />
            <CostBar label="スクラップ収益" amount={scrapRevenue} max={maxBar} color="bg-blue-400" />
            <CostBar label="人工費" amount={laborAmt} max={maxBar} color="bg-orange-400" />
            <CostBar label="燃料代" amount={fuelAmt} max={maxBar} color="bg-yellow-400" />
            <CostBar label="リース代" amount={leaseAmt} max={maxBar} color="bg-purple-400" />
            <CostBar label="経費" amount={expenseAmt} max={maxBar} color="bg-gray-400" />
          </div>
        )}
      </div>

      {/* ソート切替 */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-bold text-gray-700">記録一覧</h2>
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="text-xs text-gray-500 border rounded px-2 py-1 bg-white"
        >
          日付 {sortDir === 'desc' ? '▼ 新しい順' : '▲ 古い順'}
        </button>
      </div>

      {/* 廃材記録一覧 */}
      <h3 className="text-sm font-semibold text-gray-600 mb-2">廃材記録</h3>
      {sortedWaste.length === 0 && <p className="text-gray-400 text-sm mb-4">記録なし</p>}
      <div className="flex flex-col gap-2 mb-4">
        {sortedWaste.map((e: any) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-3 flex justify-between items-center text-sm">
            <div className="flex-1 min-w-0">
              <span className="font-medium">{e.date}</span>
              <span className="text-gray-500 mx-1">·</span>
              <span className="text-gray-500">{e.waste_types?.disposal_sites?.name}</span>
              <span className="mx-1">·</span>
              <span>{e.waste_types?.name}</span>
              <span className="text-gray-500 ml-1">{e.quantity}{e.waste_types?.unit}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className={`font-medium ${e.waste_types?.entry_type === 'revenue' ? 'text-blue-600' : 'text-red-600'}`}>
                {e.waste_types?.entry_type === 'revenue' ? '+' : ''}{fmt(Number(e.amount))}
              </span>
              <button onClick={() => openEditWaste(e)} className="text-gray-400 hover:text-blue-500 text-xs px-1 py-1">編集</button>
              <button
                onClick={() => setDeleteTarget({ table: 'waste_entries', id: e.id, label: `${e.date} ${e.waste_types?.name}` })}
                className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 py-1"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* 人工記録一覧 */}
      <h3 className="text-sm font-semibold text-gray-600 mb-2">人工記録</h3>
      {sortedLabor.length === 0 && <p className="text-gray-400 text-sm mb-4">記録なし</p>}
      <div className="flex flex-col gap-2 mb-4">
        {sortedLabor.map((e: any) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-3 flex justify-between items-center text-sm">
            <div className="flex-1">
              <span className="font-medium">{e.date}</span>
              <span className="mx-1">·</span>
              <span>{e.workers?.name}</span>
              {e.workers?.company_name && <span className="text-gray-500 ml-1">（{e.workers.company_name}）</span>}
              {e.day_type === 'half' && <span className="text-orange-500 ml-1 text-xs font-medium">（半日）</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className="font-medium">{Number(e.amount).toLocaleString()}円</span>
              <button onClick={() => openEditLabor(e)} className="text-gray-400 hover:text-blue-500 text-xs px-1 py-1">編集</button>
              <button
                onClick={() => setDeleteTarget({ table: 'labor_entries', id: e.id, label: `${e.date} ${e.workers?.name}` })}
                className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 py-1"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* その他記録一覧 */}
      <h3 className="text-sm font-semibold text-gray-600 mb-2">その他費用</h3>
      {sortedOther.length === 0 && <p className="text-gray-400 text-sm">記録なし</p>}
      <div className="flex flex-col gap-2 pb-8">
        {sortedOther.map((e) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-3 flex justify-between items-center text-sm">
            <div className="flex-1">
              <span className="font-medium">{e.date}</span>
              <span className="text-gray-500 mx-1">·</span>
              <span>{otherLabel[e.entry_type]}</span>
              {e.fuel_type && <span className="text-gray-500 ml-1">（{e.fuel_type}{Number(e.quantity) > 0 && Number(e.quantity) !== 1 ? ` ${e.quantity}L` : ''}）</span>}
              {e.note && <span className="text-gray-500 ml-1">({e.note})</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className="font-medium">{fmt(Number(e.amount))}</span>
              <button onClick={() => openEditOther(e)} className="text-gray-400 hover:text-blue-500 text-xs px-1 py-1">編集</button>
              <button
                onClick={() => setDeleteTarget({ table: 'other_entries', id: e.id, label: `${e.date} ${otherLabel[e.entry_type]}` })}
                className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 py-1"
              >✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
