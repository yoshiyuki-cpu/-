'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, Estimate, EstimateWasteItem, EstimateExtraItem } from '@/lib/supabase'
import EstimateForm from '../_components/EstimateForm'

export default function EstimateDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [data, setData] = useState<{ estimate: Estimate; wasteItems: EstimateWasteItem[]; extraItems: EstimateExtraItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: estimate }, { data: wasteItems }, { data: extraItems }] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).single(),
      supabase.from('estimate_waste_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('estimate_extra_items').select('*').eq('estimate_id', id).order('sort_order'),
    ])
    if (!estimate) { setLoading(false); return }
    setData({ estimate, wasteItems: wasteItems ?? [], extraItems: extraItems ?? [] })
    setLoading(false)
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('estimates').delete().eq('id', id)
    router.push('/estimates')
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!data) return <p className="text-center py-10 text-gray-500">見積りが見つかりません</p>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">見積り編集</h1>
        <div className="flex gap-2">
          <Link href={`/estimates/${id}/print`} className="bg-gray-700 text-white px-3 py-2 rounded text-sm font-medium">
            印刷・PDF
          </Link>
          <button onClick={() => setConfirmDelete(true)} className="text-red-500 text-sm px-2">削除</button>
        </div>
      </div>

      <EstimateForm mode="edit" estimateId={data.estimate.id} initial={data} />

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 max-w-sm w-full">
            <p className="font-medium mb-4">この見積りを削除しますか？</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 border rounded py-2 text-sm">キャンセル</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-600 text-white rounded py-2 text-sm disabled:opacity-50">
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
