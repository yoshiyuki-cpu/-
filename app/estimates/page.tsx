'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase, Estimate, EstimateStatus } from '@/lib/supabase'
import { calcEstimateTotals } from '@/lib/estimateCalc'

type EstimateWithTotal = Estimate & { total: number }

type StatusFilter = 'all' | EstimateStatus

const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: '作成中',
  sent: '提出済み',
  accepted: '受注',
  rejected: '失注',
}

const STATUS_COLOR: Record<EstimateStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-yellow-100 text-yellow-700',
  accepted: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<EstimateWithTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => { loadEstimates() }, [])

  async function loadEstimates() {
    const { data } = await supabase.from('estimates').select('*').order('created_at', { ascending: false })
    if (!data) { setLoading(false); return }

    const withTotals = await Promise.all(data.map(async (e) => {
      const { data: items } = await supabase.from('estimate_items').select('quantity, unit_price').eq('estimate_id', e.id)
      const totals = calcEstimateTotals(e, items ?? [])
      return { ...e, total: totals.total }
    }))

    setEstimates(withTotals)
    setLoading(false)
  }

  const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円'

  const filtered = useMemo(() => {
    return estimates.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false
      if (search && !e.customer_name.includes(search) && !e.site_address?.includes(search)) return false
      return true
    })
  }, [estimates, statusFilter, search])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: estimates.length, draft: 0, sent: 0, accepted: 0, rejected: 0 }
    estimates.forEach(e => { c[e.status]++ })
    return c
  }, [estimates])

  const filterBtnClass = (f: StatusFilter) =>
    `px-3 py-1 rounded-full text-sm font-medium transition whitespace-nowrap ${statusFilter === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border'}`

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-bold">見積り一覧</h1>
          <p className="text-xs text-gray-500 mt-0.5">合計 {estimates.length}件</p>
        </div>
        <Link href="/estimates/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
          + 新規見積り
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="お客様名・現場住所で検索..."
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button className={filterBtnClass('all')} onClick={() => setStatusFilter('all')}>すべて ({counts.all})</button>
          <button className={filterBtnClass('draft')} onClick={() => setStatusFilter('draft')}>作成中 ({counts.draft})</button>
          <button className={filterBtnClass('sent')} onClick={() => setStatusFilter('sent')}>提出済み ({counts.sent})</button>
          <button className={filterBtnClass('accepted')} onClick={() => setStatusFilter('accepted')}>受注 ({counts.accepted})</button>
          <button className={filterBtnClass('rejected')} onClick={() => setStatusFilter('rejected')}>失注 ({counts.rejected})</button>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-gray-500 text-center py-10">
          {search || statusFilter !== 'all' ? '該当する見積りがありません' : '見積りがありません。新規見積りを作成してください。'}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map(e => (
          <Link key={e.id} href={`/estimates/${e.id}`}>
            <div className="bg-white rounded-lg shadow p-4 hover:shadow-md transition active:scale-[0.99]">
              <div className="flex justify-between items-start mb-1">
                <div>
                  <h2 className="font-bold text-lg">{e.customer_name}</h2>
                  {e.site_address && <p className="text-xs text-gray-400 mt-0.5">📍 {e.site_address}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">{e.issue_date}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${STATUS_COLOR[e.status]}`}>
                  {STATUS_LABEL[e.status]}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t">
                <span className="text-sm text-gray-600">見積合計（税込）</span>
                <span className="font-bold text-lg text-blue-700">{fmt(e.total)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
