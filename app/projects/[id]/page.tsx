'use client'
import { useEffect, useState } from 'react'
import { supabase, Project, WasteEntry, OtherEntry } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ProjectDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [wasteEntries, setWasteEntries] = useState<WasteEntry[]>([])
  const [otherEntries, setOtherEntries] = useState<OtherEntry[]>([])
  const [laborEntries, setLaborEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: p }, { data: we }, { data: oe }, { data: le }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('waste_entries').select('*, waste_types(name, unit, entry_type, disposal_sites(name))').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('other_entries').select('*').eq('project_id', id).order('date', { ascending: false }),
      supabase.from('labor_entries').select('*, workers(name, company_name)').eq('project_id', id).order('date', { ascending: false }),
    ])
    setProject(p)
    setWasteEntries((we as any) ?? [])
    setOtherEntries((oe as any) ?? [])
    setLaborEntries((le as any) ?? [])
    setLoading(false)
  }

  async function deleteWasteEntry(entryId: number) {
    if (!confirm('この記録を削除しますか？')) return
    await supabase.from('waste_entries').delete().eq('id', entryId)
    load()
  }

  async function deleteOtherEntry(entryId: number) {
    if (!confirm('この記録を削除しますか？')) return
    await supabase.from('other_entries').delete().eq('id', entryId)
    load()
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

  const otherLabel: Record<string, string> = { labor: '人工', fuel: '燃料代', lease: 'リース代' }

  return (
    <div>
      <button onClick={() => router.push('/')} className="text-blue-600 text-sm mb-3">← 現場一覧</button>
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
        <Link href={`/projects/${id}/entry`} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
          + 入力
        </Link>
      </div>

      {/* 集計カード */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-bold mb-2 text-gray-700">集計</h2>
        <div className="grid grid-cols-2 gap-1 text-sm">
          <div className="text-gray-600">廃材処分費</div><div className="text-right font-medium text-red-600">{fmt(wasteCost)}</div>
          <div className="text-gray-600">スクラップ収益</div><div className="text-right font-medium text-blue-600">{fmt(scrapRevenue)}</div>
          <div className="text-gray-600">人工費</div><div className="text-right">{fmt(laborAmt)}</div>
          <div className="text-gray-600">燃料代</div><div className="text-right">{fmt(fuelAmt)}</div>
          <div className="text-gray-600">リース代</div><div className="text-right">{fmt(leaseAmt)}</div>
          <div className="font-bold border-t pt-1 mt-1">支出合計</div>
          <div className="text-right font-bold border-t pt-1 mt-1 text-red-700">{fmt(totalCost)}</div>
        </div>
      </div>

      {/* 廃材記録一覧 */}
      <h2 className="font-bold mb-2 text-gray-700">廃材記録</h2>
      {wasteEntries.length === 0 && <p className="text-gray-400 text-sm mb-4">記録なし</p>}
      <div className="flex flex-col gap-2 mb-4">
        {wasteEntries.map((e: any) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-2 flex justify-between items-center text-sm">
            <div>
              <span className="font-medium">{e.date}</span>
              <span className="text-gray-500 mx-1">·</span>
              <span className="text-gray-500">{e.waste_types?.disposal_sites?.name}</span>
              <span className="mx-1">·</span>
              <span>{e.waste_types?.name}</span>
              <span className="text-gray-500 ml-1">{e.quantity}{e.waste_types?.unit}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${e.waste_types?.entry_type === 'revenue' ? 'text-blue-600' : 'text-red-600'}`}>
                {e.waste_types?.entry_type === 'revenue' ? '+' : ''}{fmt(Number(e.amount))}
              </span>
              <button onClick={() => deleteWasteEntry(e.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* 人工記録一覧 */}
      <h2 className="font-bold mb-2 text-gray-700">人工記録</h2>
      {laborEntries.length === 0 && <p className="text-gray-400 text-sm mb-4">記録なし</p>}
      <div className="flex flex-col gap-2 mb-4">
        {laborEntries.map((e: any) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-2 flex justify-between items-center text-sm">
            <div>
              <span className="font-medium">{e.date}</span>
              <span className="mx-1">·</span>
              <span>{e.workers?.name}</span>
              {e.workers?.company_name && <span className="text-gray-500 ml-1">（{e.workers.company_name}）</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{Number(e.amount).toLocaleString()}円</span>
              <button onClick={async () => { if (!confirm('削除しますか？')) return; await supabase.from('labor_entries').delete().eq('id', e.id); load() }} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* その他記録一覧 */}
      <h2 className="font-bold mb-2 text-gray-700">その他費用</h2>
      {otherEntries.length === 0 && <p className="text-gray-400 text-sm">記録なし</p>}
      <div className="flex flex-col gap-2">
        {otherEntries.map((e) => (
          <div key={e.id} className="bg-white rounded shadow px-3 py-2 flex justify-between items-center text-sm">
            <div>
              <span className="font-medium">{e.date}</span>
              <span className="text-gray-500 mx-1">·</span>
              <span>{otherLabel[e.entry_type]}</span>
              {e.note && <span className="text-gray-500 ml-1">({e.note})</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{fmt(Number(e.amount))}</span>
              <button onClick={() => deleteOtherEntry(e.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
