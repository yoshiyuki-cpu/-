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

// PostgREST は1回の問い合わせで最大1000行までしか返さない。
// 記録が増えても合計が黙って欠けないよう、無くなるまで続きを取る
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const PAGE = 1000
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1)
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectWithTotals[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string; records: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (!projectData) { setLoading(false); return }

    // ごみ箱に入れた現場を除く。deleted_atの絞り込みはDB側でやらずここで行う
    // （列が未追加の環境でも一覧が消えないようにするため）
    const visible = projectData.filter(p => !p.deleted_at)

    // 以前は現場ごとに4回ずつ問い合わせていて（24現場で約100回）、スマホの回線では
    // 開くのに数秒かかっていた。全記録を4回で取り、現場ごとに振り分ける
    const [wasteRows, otherRows, laborRows, scrapRows] = await Promise.all([
      fetchAll<{ project_id: number; amount: number; waste_types: { entry_type: string } | { entry_type: string }[] | null }>(
        (f, t) => supabase.from('waste_entries').select('project_id, amount, waste_types(entry_type)').range(f, t)),
      fetchAll<{ project_id: number; entry_type: string; amount: number }>(
        (f, t) => supabase.from('other_entries').select('project_id, entry_type, amount').range(f, t)),
      fetchAll<{ project_id: number; amount: number }>(
        (f, t) => supabase.from('labor_entries').select('project_id, amount').range(f, t)),
      fetchAll<{ project_id: number; amount: number }>(
        (f, t) => supabase.from('scrap_records').select('project_id, amount').range(f, t)),
    ])

    const totals = new Map<number, Omit<ProjectWithTotals, keyof Project>>()
    const of = (id: number) => {
      if (!totals.has(id)) totals.set(id, { waste_cost: 0, scrap_revenue: 0, labor_amount: 0, fuel_amount: 0, lease_amount: 0, expense_amount: 0 })
      return totals.get(id)!
    }
    const entryTypeOf = (w: { entry_type: string } | { entry_type: string }[] | null) =>
      !w ? null : Array.isArray(w) ? w[0]?.entry_type ?? null : w.entry_type

    wasteRows.forEach(e => {
      // 現場詳細の集計と同じ扱い：cost 以外（revenue）はスクラップ収益
      if (entryTypeOf(e.waste_types) === 'cost') of(e.project_id).waste_cost += Number(e.amount)
      else of(e.project_id).scrap_revenue += Number(e.amount)
    })
    scrapRows.forEach(r => { of(r.project_id).scrap_revenue += Number(r.amount) })
    otherRows.forEach(e => {
      const t = of(e.project_id)
      if (e.entry_type === 'labor') t.labor_amount += Number(e.amount)
      else if (e.entry_type === 'fuel') t.fuel_amount += Number(e.amount)
      else if (e.entry_type === 'lease') t.lease_amount += Number(e.amount)
      else if (e.entry_type === 'expense') t.expense_amount += Number(e.amount)
    })
    laborRows.forEach(e => { of(e.project_id).labor_amount += Number(e.amount) })

    setProjects(visible.map(p => ({ ...p, ...of(p.id) })))
    setLoading(false)
  }

  // 消すのではなく、ごみ箱に入れる。記録は残り、段取り画面の「ごみ箱」から戻せる。
  // 以前はここだけ本当に削除していて、紐づく記録ごと消えて戻せなかった
  async function askDelete(p: ProjectWithTotals) {
    setDeleteError('')
    const tables = ['waste_entries', 'labor_entries', 'other_entries', 'scrap_records', 'ky_photos', 'meeting_notes', 'pipe_diagrams']
    const counts = await Promise.all(tables.map(async t => {
      const { count } = await supabase.from(t).select('id', { count: 'exact', head: true }).eq('project_id', p.id)
      return count ?? 0
    }))
    setDeleteTarget({ id: p.id, name: p.name, records: counts.reduce((s, c) => s + c, 0) })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    const { error } = await supabase.from('projects')
      .update({ deleted_at: new Date().toISOString() }).eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) {
      setDeleteError(error.message.includes('deleted_at')
        ? 'ごみ箱の準備がまだです。Supabaseで supabase-schema-project-trash.sql を実行してください。'
        : 'ごみ箱に入れられませんでした。' + error.message)
      return
    }
    setDeleteTarget(null)
    setProjects(ps => ps.filter(p => p.id !== deleteTarget.id))
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
      {/* 表紙：会社の顔となるヒーロー（従来デザイン） */}
      <section className="hero-v1 no-print relative overflow-hidden rounded-3xl mb-5 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white shadow-lg">
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
          <h1 className="text-[24px] leading-tight font-bold tracking-tight">
            岡山で一番信頼される<br />解体会社を目指そう！！
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

      {/* 新デザイン：表紙は畳み、数字の帯と「今日の入力へ」の近道だけ置く。
          表紙の言葉は起動時のスプラッシュに残っているので、毎回は見せない */}
      <section className="hero-v2 no-print mb-4">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
            <p className="text-[10px] text-gray-400">稼働中</p>
            <p className="text-lg font-bold leading-tight text-emerald-700">{activeCount}<span className="text-xs font-medium ml-0.5 text-gray-500">件</span></p>
          </div>
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
            <p className="text-[10px] text-gray-400">完了</p>
            <p className="text-lg font-bold leading-tight">{completedCount}<span className="text-xs font-medium ml-0.5 text-gray-500">件</span></p>
          </div>
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
            <p className="text-[10px] text-gray-400">累計</p>
            <p className="text-lg font-bold leading-tight">{projects.length}<span className="text-xs font-medium ml-0.5 text-gray-500">件</span></p>
          </div>
        </div>
        {/* 職長が毎日やる操作へ、一覧を探さずに飛べる近道 */}
        {activeCount > 0 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
            {projects.filter(p => p.status === 'active').map(p => (
              <Link key={p.id} href={`/projects/${p.id}/entry`}
                className="shrink-0 whitespace-nowrap bg-blue-600 text-white text-sm font-medium px-3.5 py-2 rounded-full shadow-sm">
                ＋ {p.name} に入力
              </Link>
            ))}
          </div>
        )}
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
                      onClick={e => { e.preventDefault(); e.stopPropagation(); askDelete(p) }}
                      className="text-xs text-gray-300 hover:text-red-400 px-1">ごみ箱へ</button>
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
            <h3 className="font-bold text-lg mb-2">ごみ箱に入れますか？</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-medium text-gray-900">{deleteTarget.name}</span> を一覧から隠します。<br />
              {deleteTarget.records > 0
                ? <>記録{deleteTarget.records}件も一緒に隠れますが、<span className="font-medium">消えるわけではありません。</span></>
                : '記録は入っていません。'}
              <br />段取り画面の「ごみ箱」からいつでも元に戻せます。
            </p>
            {deleteError && <p className="text-sm text-red-600 mb-3">{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 border rounded-lg text-gray-600 font-medium">
                キャンセル
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2 bg-gray-700 text-white rounded-lg font-medium disabled:opacity-50">
                {deleting ? '処理中...' : 'ごみ箱に入れる'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
