'use client'
import { useEffect, useState } from 'react'
import { supabase, Project, WasteEntry, OtherEntry } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type SortDir = 'asc' | 'desc'
type DeleteTarget = { table: 'waste_entries' | 'other_entries' | 'labor_entries'; id: number; label: string }

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
  const [loading, setLoading] = useState(true)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showChart, setShowChart] = useState(true)
  const [editNotes, setEditNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: p }, { data: we }, { data: oe }, { data: le }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('waste_entries').select('*, waste_types(name, unit, entry_type, disposal_sites(name))').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('other_entries').select('*').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('labor_entries').select('*, workers(name, company_name)').eq('project_id', id).order('date', { ascending: false }),
    ])
    setProject(p)
    setNotesValue(p?.notes ?? '')
    setWasteEntries((we as any) ?? [])
    setOtherEntries((oe as any) ?? [])
    setLaborEntries((le as any) ?? [])
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

  async function saveNotes() {
    await supabase.from('projects').update({ notes: notesValue || null }).eq('id', id)
    setEditNotes(false)
    load()
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
      rows.push([e.date, '人工費', '', e.workers?.name ?? '', '1', '人', String(e.amount)])
    })

    sortedOther.forEach((e: any) => {
      const label = e.entry_type === 'fuel' ? '燃料代' : 'リース代'
      rows.push([e.date, label, '', e.note ?? '', '1', '式', String(e.amount)])
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
  const laborAmt = laborEntries.reduce((s, e) => s + Number(e.amount), 0) + otherEntries.filter(e => e.entry_type === 'labor').reduce((s, e) => s + Number(e.amount), 0)
  const fuelAmt = otherEntries.filter(e => e.entry_type === 'fuel').reduce((s, e) => s + Number(e.amount), 0)
  const leaseAmt = otherEntries.filter(e => e.entry_type === 'lease').reduce((s, e) => s + Number(e.amount), 0)
  const totalCost = wasteCost + laborAmt + fuelAmt + leaseAmt
  const profit = scrapRevenue - totalCost
  const isProfit = profit >= 0
  const maxBar = Math.max(wasteCost, laborAmt, fuelAmt, leaseAmt, scrapRevenue, 1)

  const sortFn = (a: any, b: any) =>
    sortDir === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)

  const sortedWaste = [...wasteEntries].sort(sortFn)
  const sortedLabor = [...laborEntries].sort(sortFn)
  const sortedOther = [...otherEntries].sort(sortFn)

  const otherLabel: Record<string, string> = { labor: '人工', fuel: '燃料代', lease: 'リース代' }

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
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className="font-medium">{Number(e.amount).toLocaleString()}円</span>
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
              {e.note && <span className="text-gray-500 ml-1">({e.note})</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className="font-medium">{fmt(Number(e.amount))}</span>
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
