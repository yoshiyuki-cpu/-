'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase, Project } from '@/lib/supabase'
import Link from 'next/link'

type ProjectWithTotals = Project & {
  waste_cost: number
  scrap_revenue: number
  labor_amount: number
  fuel_amount: number
  lease_amount: number
}

type StatusFilter = 'all' | 'active' | 'completed'

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectWithTotals[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (!projectData) { setLoading(false); return }

    const withTotals = await Promise.all(projectData.map(async (p) => {
      const [{ data: wasteEntries }, { data: otherEntries }, { data: laborEntries }] = await Promise.all([
        supabase.from('waste_entries').select('amount, waste_types(entry_type)').eq('project_id', p.id),
        supabase.from('other_entries').select('entry_type, amount').eq('project_id', p.id),
        supabase.from('labor_entries').select('amount').eq('project_id', p.id),
      ])

      let waste_cost = 0, scrap_revenue = 0
      wasteEntries?.forEach((e: any) => {
        if (e.waste_types?.entry_type === 'cost') waste_cost += Number(e.amount)
        else scrap_revenue += Number(e.amount)
      })

      let labor_amount = 0, fuel_amount = 0, lease_amount = 0
      otherEntries?.forEach((e: any) => {
        if (e.entry_type === 'labor') labor_amount += Number(e.amount)
        else if (e.entry_type === 'fuel') fuel_amount += Number(e.amount)
        else if (e.entry_type === 'lease') lease_amount += Number(e.amount)
      })
      laborEntries?.forEach((e: any) => { labor_amount += Number(e.amount) })

      return { ...p, waste_cost, scrap_revenue, labor_amount, fuel_amount, lease_amount }
    }))

    setProjects(withTotals)
    setLoading(false)
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP') + '円'

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (search && !p.name.includes(search) && !p.location?.includes(search)) return false
      return true
    })
  }, [projects, statusFilter, search])

  const activeCount = projects.filter(p => p.status === 'active').length
  const completedCount = projects.filter(p => p.status === 'completed').length

  const filterBtnClass = (f: StatusFilter) =>
    `px-3 py-1 rounded-full text-sm font-medium transition ${statusFilter === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border'}`

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold">現場一覧</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            進行中 {activeCount}件　完了 {completedCount}件　合計 {projects.length}件
          </p>
        </div>
        <Link href="/projects/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
          + 新規現場
        </Link>
      </div>

      {/* 検索・絞り込み */}
      <div className="mb-4 flex flex-col gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="現場名・場所で検索..."
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
        />
        <div className="flex gap-2">
          <button className={filterBtnClass('all')} onClick={() => setStatusFilter('all')}>すべて ({projects.length})</button>
          <button className={filterBtnClass('active')} onClick={() => setStatusFilter('active')}>進行中 ({activeCount})</button>
          <button className={filterBtnClass('completed')} onClick={() => setStatusFilter('completed')}>完了 ({completedCount})</button>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-gray-500 text-center py-10">
          {search || statusFilter !== 'all' ? '該当する現場がありません' : '現場がありません。新規現場を登録してください。'}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((p) => {
          const totalCost = p.waste_cost + p.labor_amount + p.fuel_amount + p.lease_amount
          const profit = p.scrap_revenue - totalCost
          const isProfit = profit >= 0
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="bg-white rounded-lg shadow p-4 hover:shadow-md transition active:scale-[0.99]">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h2 className="font-bold text-lg">{p.name}</h2>
                    <p className="text-sm text-gray-500">{p.start_date} 〜 {p.end_date ?? '進行中'}</p>
                    {p.location && <p className="text-xs text-gray-400 mt-0.5">📍 {p.location}</p>}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.status === 'active' ? '進行中' : '完了'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-sm mt-2">
                  <div className="text-gray-600">廃材処分費</div><div className="text-right font-medium text-red-600">{fmt(p.waste_cost)}</div>
                  <div className="text-gray-600">スクラップ収益</div><div className="text-right font-medium text-blue-600">{fmt(p.scrap_revenue)}</div>
                  <div className="text-gray-600">人工費</div><div className="text-right">{fmt(p.labor_amount)}</div>
                  <div className="text-gray-600">燃料代</div><div className="text-right">{fmt(p.fuel_amount)}</div>
                  <div className="text-gray-600">リース代</div><div className="text-right">{fmt(p.lease_amount)}</div>
                  <div className="font-bold border-t pt-1 mt-1">支出合計</div>
                  <div className="text-right font-bold border-t pt-1 mt-1 text-red-700">{fmt(totalCost)}</div>
                </div>
                <div className={`mt-2 pt-2 border-t flex justify-between items-center rounded px-2 py-1 ${isProfit ? 'bg-blue-50' : 'bg-red-50'}`}>
                  <span className="text-sm font-bold text-gray-700">差引損益</span>
                  <span className={`font-bold text-base ${isProfit ? 'text-blue-700' : 'text-red-700'}`}>
                    {isProfit ? '+' : ''}{fmt(profit)}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
