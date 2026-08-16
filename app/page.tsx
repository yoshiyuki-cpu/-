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
  expense_amount: number
}

type StatusFilter = 'all' | 'active' | 'completed'

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectWithTotals[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (!projectData) { setLoading(false); return }

    const withTotals = await Promise.all(projectData.map(async (p) => {
      const [{ data: wasteEntries }, { data: otherEntries }, { data: laborEntries }, { data: scrapRecords }] = await Promise.all([
        supabase.from('waste_entries').select('amount, waste_types(entry_type)').eq('project_id', p.id),
        supabase.from('other_entries').select('entry_type, amount').eq('project_id', p.id),
        supabase.from('labor_entries').select('amount').eq('project_id', p.id),
        supabase.from('scrap_records').select('amount').eq('project_id', p.id),
      ])

      let waste_cost = 0, scrap_revenue = 0
      wasteEntries?.forEach((e: any) => {
        if (e.waste_types?.entry_type === 'cost') waste_cost += Number(e.amount)
        else scrap_revenue += Number(e.amount)
      })
      scrapRecords?.forEach((r: any) => { scrap_revenue += Number(r.amount) })

      let labor_amount = 0, fuel_amount = 0, lease_amount = 0, expense_amount = 0
      otherEntries?.forEach((e: any) => {
        if (e.entry_type === 'labor') labor_amount += Number(e.amount)
        else if (e.entry_type === 'fuel') fuel_amount += Number(e.amount)
        else if (e.entry_type === 'lease') lease_amount += Number(e.amount)
        else if (e.entry_type === 'expense') expense_amount += Number(e.amount)
      })
      laborEntries?.forEach((e: any) => { labor_amount += Number(e.amount) })

      return { ...p, waste_cost, scrap_revenue, labor_amount, fuel_amount, lease_amount, expense_amount }
    }))

    setProjects(withTotals)
    setLoading(false)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    const { error } = await supabase.from('projects').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) {
      setDeleteError('削除に失敗しました。' + error.message)
      return
    }
    setDeleteTarget(null)
    loadProjects()
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
    `px-3.5 py-1.5 rounded-full text-sm font-medium transition ${statusFilter === f ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      {/* 表紙：会社の顔となるヒーロー */}
      <section className="no-print relative overflow-hidden rounded-3xl mb-5 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white shadow-lg">
        {/* 背景の重機シルエットと光 */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* 右上から差す光 */}
          <div className="absolute -top-20 -right-10 w-64 h-64 rounded-full bg-blue-400/20 blur-3xl" />
          {/* 重機シルエット（右上に小さく配置し、数値カードと重ならないようにする） */}
          <svg viewBox="0 0 200 120" className="absolute right-1 top-2 h-24 w-auto text-white/[0.09]" fill="currentColor">
            {/* ブーム（本体から斜め上へ） */}
            <path d="M126 62 L92 22 L102 14 L138 56 Z" />
            {/* アーム（ブーム先端から前下へ） */}
            <path d="M96 18 L54 48 L62 60 L104 30 Z" />
            {/* バケット */}
            <path d="M58 44 L74 62 L60 74 L40 66 L42 48 Z" />
            {/* 運転席 */}
            <path d="M132 34 L164 34 L168 58 L132 58 Z" />
            {/* 本体 */}
            <rect x="118" y="58" width="66" height="26" rx="5" />
            {/* クローラー */}
            <rect x="112" y="86" width="80" height="18" rx="9" />
          </svg>
        </div>

        <div className="relative px-5 py-6">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] tracking-[0.2em] text-blue-200/90 font-medium">OKAYAMA · DEMOLITION</span>
          </div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">
            岡山の解体を、<br />一番たしかに。
          </h1>
          <p className="text-[13px] text-blue-100/80 mt-2 leading-relaxed">
            株式会社良心 ─ 安全第一・確実な施工で、地域の信頼に応えます。
          </p>

          <div className="grid grid-cols-3 gap-2 mt-5">
            <div className="rounded-2xl bg-white/10 backdrop-blur-sm px-3 py-2.5 border border-white/10">
              <p className="text-[10px] text-blue-200/80">稼働中の現場</p>
              <p className="text-xl font-bold leading-tight">{activeCount}<span className="text-xs font-medium ml-0.5">件</span></p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur-sm px-3 py-2.5 border border-white/10">
              <p className="text-[10px] text-blue-200/80">完了実績</p>
              <p className="text-xl font-bold leading-tight">{completedCount}<span className="text-xs font-medium ml-0.5">件</span></p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur-sm px-3 py-2.5 border border-white/10">
              <p className="text-[10px] text-blue-200/80">累計現場</p>
              <p className="text-xl font-bold leading-tight">{projects.length}<span className="text-xs font-medium ml-0.5">件</span></p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold">現場一覧</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            進行中 {activeCount}件　完了 {completedCount}件　合計 {projects.length}件
          </p>
        </div>
        <Link href="/projects/new" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-full text-sm font-semibold shadow-sm transition">
          ＋ 新規現場
        </Link>
      </div>

      {/* 検索・絞り込み */}
      <div className="mb-4 flex flex-col gap-2.5">
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="現場名・場所で検索..."
            className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 transition"
          />
        </div>
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
          const totalCost = p.waste_cost + p.labor_amount + p.fuel_amount + p.lease_amount + p.expense_amount
          const profit = p.scrap_revenue - totalCost
          const isProfit = profit >= 0
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition active:scale-[0.99]">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h2 className="font-bold text-lg tracking-tight">{p.name}</h2>
                    <p className="text-sm text-gray-500">{p.start_date} 〜 {p.end_date ?? '進行中'}</p>
                    {p.location && <p className="text-xs text-gray-400 mt-0.5">📍 {p.location}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {p.status === 'active' ? '進行中' : '完了'}
                    </span>
                    <button type="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteError(''); setDeleteTarget({ id: p.id, name: p.name }) }}
                      className="text-xs text-gray-300 hover:text-red-400 px-1">削除</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 text-sm mt-2">
                  <div className="text-gray-600">廃材処分費</div><div className="text-right font-medium text-red-600">{fmt(p.waste_cost)}</div>
                  <div className="text-gray-600">スクラップ収益</div><div className="text-right font-medium text-blue-600">{fmt(p.scrap_revenue)}</div>
                  <div className="text-gray-600">人工費</div><div className="text-right">{fmt(p.labor_amount)}</div>
                  <div className="text-gray-600">燃料代</div><div className="text-right">{fmt(p.fuel_amount)}</div>
                  <div className="text-gray-600">リース代</div><div className="text-right">{fmt(p.lease_amount)}</div>
                  <div className="text-gray-600">経費</div><div className="text-right">{fmt(p.expense_amount)}</div>
                  <div className="font-bold border-t pt-1 mt-1">支出合計</div>
                  <div className="text-right font-bold border-t pt-1 mt-1 text-red-700">{fmt(totalCost)}</div>
                </div>
                <div className={`mt-3 flex justify-between items-center rounded-xl px-3 py-2 ${isProfit ? 'bg-blue-50' : 'bg-red-50'}`}>
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

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">現場を削除しますか？</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-medium text-gray-900">{deleteTarget.name}</span> を削除します。<br />
              この現場に紐づく廃材・経費・見積り・足場計算・議事録などの記録もすべて削除され、元に戻せません。
              重複して作成した現場や、テストで作った現場を消すときのみ使ってください。
            </p>
            {deleteError && <p className="text-sm text-red-600 mb-3">{deleteError}</p>}
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
    </div>
  )
}
