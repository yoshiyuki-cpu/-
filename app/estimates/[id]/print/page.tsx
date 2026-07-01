'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Estimate, EstimateWasteItem, EstimateExtraItem, CompanySettings } from '@/lib/supabase'
import { calcEstimateTotals } from '@/lib/estimateCalc'

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP')

export default function EstimatePrintPage() {
  const { id } = useParams()
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [wasteItems, setWasteItems] = useState<EstimateWasteItem[]>([])
  const [extraItems, setExtraItems] = useState<EstimateExtraItem[]>([])
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: e }, { data: wi }, { data: xi }, { data: c }] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).single(),
      supabase.from('estimate_waste_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('estimate_extra_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('company_settings').select('*').eq('id', 1).single(),
    ])
    setEstimate(e)
    setWasteItems(wi ?? [])
    setExtraItems(xi ?? [])
    setCompany(c)
    setLoading(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!estimate) return <p className="text-center py-10 text-gray-500">見積りが見つかりません</p>

  const totals = calcEstimateTotals(estimate, wasteItems, extraItems)
  const estimateNo = `EST-${String(estimate.id).padStart(4, '0')}`

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 print:px-0 print:py-0 text-gray-900">
      <div className="no-print flex justify-end mb-4">
        <button onClick={() => window.print()} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">
          印刷する（PDF保存も可）
        </button>
      </div>

      <div className="flex justify-between items-start mb-6 text-sm">
        <span>No. {estimateNo}</span>
        <span>発行日：{estimate.issue_date}</span>
      </div>

      <h1 className="text-center text-2xl font-bold tracking-widest mb-8">御 見 積 書</h1>

      <div className="flex justify-between items-end mb-8">
        <div>
          <p className="text-lg font-bold border-b border-gray-800 pb-1 min-w-[220px]">{estimate.customer_name} 様</p>
          {estimate.customer_address && <p className="text-sm mt-1">{estimate.customer_address}</p>}
          {estimate.customer_contact && <p className="text-sm">{estimate.customer_contact}</p>}
        </div>
        <div className="text-sm text-right">
          <p className="font-bold text-base">{company?.name ?? '株式会社良心'}</p>
          {company?.postal_code && <p>〒{company.postal_code}</p>}
          {company?.address && <p>{company.address}</p>}
          {company?.tel && <p>TEL：{company.tel}{company?.fax ? `　FAX：${company.fax}` : ''}</p>}
          {company?.license_no && <p>{company.license_no}</p>}
          {company?.representative && <p>代表者：{company.representative}</p>}
        </div>
      </div>

      <div className="border-2 border-gray-800 rounded px-4 py-3 mb-8 flex justify-between items-center">
        <span className="font-bold">御見積金額</span>
        <span className="font-bold text-2xl">¥{fmt(totals.total)}-（税込）</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 text-sm mb-6">
        <div>
          {estimate.site_address && <p><span className="text-gray-500">現場住所：</span>{estimate.site_address}</p>}
          {estimate.building_structure && <p><span className="text-gray-500">建物構造：</span>{estimate.building_structure}</p>}
          {estimate.floor_area != null && <p><span className="text-gray-500">延床面積：</span>{estimate.floor_area}㎡</p>}
        </div>
        <div className="text-right">
          {estimate.valid_until && <p><span className="text-gray-500">見積有効期限：</span>{estimate.valid_until}</p>}
        </div>
      </div>

      <table className="w-full text-sm border-collapse mb-6">
        <thead>
          <tr className="border-b-2 border-gray-800">
            <th className="text-left py-2 font-medium">項目</th>
            <th className="text-right py-2 font-medium w-20">数量</th>
            <th className="text-right py-2 font-medium w-16">単位</th>
            <th className="text-right py-2 font-medium w-28">単価</th>
            <th className="text-right py-2 font-medium w-32">金額</th>
          </tr>
        </thead>
        <tbody>
          {estimate.building_amount > 0 && (
            <tr className="border-b border-gray-300">
              <td className="py-2">解体工事一式（{estimate.building_structure}）</td>
              <td className="text-right py-2">{estimate.floor_area ?? '-'}</td>
              <td className="text-right py-2">㎡</td>
              <td className="text-right py-2">{estimate.unit_price != null ? fmt(estimate.unit_price) : '-'}</td>
              <td className="text-right py-2">{fmt(estimate.building_amount)}</td>
            </tr>
          )}
          {wasteItems.map(w => (
            <tr key={w.id} className="border-b border-gray-300">
              <td className="py-2">{w.name}（処分費）</td>
              <td className="text-right py-2">{w.quantity}</td>
              <td className="text-right py-2">{w.unit}</td>
              <td className="text-right py-2">{fmt(w.unit_price)}</td>
              <td className="text-right py-2">{fmt(w.quantity * w.unit_price)}</td>
            </tr>
          ))}
          {extraItems.map(x => (
            <tr key={x.id} className="border-b border-gray-300">
              <td className="py-2">{x.name}</td>
              <td className="text-right py-2">-</td>
              <td className="text-right py-2">-</td>
              <td className="text-right py-2">-</td>
              <td className="text-right py-2">{fmt(x.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-8">
        <div className="w-64 text-sm flex flex-col gap-1">
          <div className="flex justify-between"><span>小計</span><span>¥{fmt(totals.subtotal)}</span></div>
          <div className="flex justify-between"><span>諸経費（{estimate.expense_rate}%）</span><span>¥{fmt(totals.expenseAmount)}</span></div>
          {estimate.discount_amount > 0 && (
            <div className="flex justify-between"><span>値引き</span><span>-¥{fmt(estimate.discount_amount)}</span></div>
          )}
          <div className="flex justify-between"><span>消費税（{estimate.tax_rate}%）</span><span>¥{fmt(totals.taxAmount)}</span></div>
          <div className="flex justify-between font-bold text-base border-t border-gray-800 pt-1 mt-1">
            <span>合計金額</span><span>¥{fmt(totals.total)}</span>
          </div>
        </div>
      </div>

      {estimate.notes && (
        <div className="text-sm">
          <p className="text-gray-500 mb-1">備考</p>
          <p className="whitespace-pre-wrap border rounded p-3">{estimate.notes}</p>
        </div>
      )}
    </div>
  )
}
