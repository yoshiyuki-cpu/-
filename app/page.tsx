'use client'
import { useEffect, useState } from 'react'
import { supabase, Project } from '@/lib/supabase'
import Link from 'next/link'

type ProjectWithTotals = Project & {
  waste_cost: number
  scrap_revenue: number
  labor_amount: number
  fuel_amount: number
  lease_amount: number
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectWithTotals[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (!projectData) { setLoading(false); return }

    const withTotals = await Promise.all(projectData.map(async (p) => {
      const { data: wasteEntries } = await supabase
        .from('waste_entries')
        .select('amount, waste_types(entry_type)')
        .eq('project_id', p.id)

      const { data: otherEntries } = await supabase
        .from('other_entries')
        .select('entry_type, amount')
        .eq('project_id', p.id)

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

      return { ...p, waste_cost, scrap_revenue, labor_amount, fuel_amount, lease_amount }
    }))

    setProjects(withTotals)
    setLoading(false)
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP') + '円'

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">現場一覧</h1>
        <Link href="/projects/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
          + 新規現場
        </Link>
      </div>

      {projects.length === 0 && (
        <p className="text-gray-500 text-center py-10">現場がありません。新規現場を登録してください。</p>
      )}

      <div className="flex flex-col gap-3">
        {projects.map((p) => {
          const totalCost = p.waste_cost + p.labor_amount + p.fuel_amount + p.lease_amount
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h2 className="font-bold text-lg">{p.name}</h2>
                    <p className="text-sm text-gray-500">{p.start_date} 〜 {p.end_date ?? '進行中'}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
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
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
