'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Estimate, EstimateItem, CompanySettings } from '@/lib/supabase'
import { calcEstimateTotals, formatDateJp } from '@/lib/estimateCalc'

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP')
const MIN_ROWS = 15

function FieldLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="shrink-0">{label}：</span>
      <span className="flex-1 border-b border-gray-800 min-h-[1.4em] px-1">{value}</span>
    </div>
  )
}

export default function EstimatePrintPage() {
  const { id } = useParams()
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [items, setItems] = useState<EstimateItem[]>([])
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: e }, { data: it }, { data: c }] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).single(),
      supabase.from('estimate_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('company_settings').select('*').eq('id', 1).single(),
    ])
    setEstimate(e)
    setItems(it ?? [])
    setCompany(c)
    setLoading(false)
  }

  async function handleDownloadPdf() {
    if (!estimate || !pageRef.current) return
    setDownloading(true)
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ])
    const canvas = await html2canvas(pageRef.current, { scale: 2, backgroundColor: '#ffffff' })
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    const imgData = canvas.toDataURL('image/png')

    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    const safeName = estimate.customer_name.replace(/[\\/:*?"<>|]/g, '')
    pdf.save(`御見積書_${safeName}.pdf`)
    setDownloading(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!estimate) return <p className="text-center py-10 text-gray-500">見積りが見つかりません</p>

  const totals = calcEstimateTotals(estimate, items)
  const filler = Math.max(0, MIN_ROWS - items.length)

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 print:px-0 print:py-0 text-gray-900">
      <div className="no-print flex justify-end gap-2 mb-4">
        <button onClick={() => window.print()} className="bg-gray-600 text-white px-4 py-2 rounded text-sm font-medium">
          印刷する
        </button>
        <button onClick={handleDownloadPdf} disabled={downloading} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
          {downloading ? 'PDF作成中...' : 'PDFダウンロード'}
        </button>
      </div>

      <div ref={pageRef} className="bg-white p-8 text-sm">
        <h1 className="text-center text-2xl font-bold tracking-widest mb-6">御見積書</h1>

        <div className="flex justify-between items-end mb-3">
          <p className="text-xl">{estimate.customer_name}　{estimate.customer_honorific}</p>
          <p>見積日　　{formatDateJp(estimate.issue_date)}</p>
        </div>

        {estimate.project_name && (
          <p className="font-bold mb-2">件名：　{estimate.project_name}</p>
        )}

        <div className="flex justify-between items-start gap-8 mb-6">
          <div className="flex-1 flex flex-col gap-1.5">
            <p className="mb-1">下記のとおり、見積もりいたします。</p>
            <FieldLine label="現場住所" value={estimate.site_address} />
            <FieldLine label="工期" value={estimate.construction_period} />
            <FieldLine label="支払期日" value={estimate.payment_due_date} />
            <FieldLine label="支払条件" value={estimate.payment_terms} />
            <FieldLine label="見積No" value={estimate.estimate_no} />
          </div>
          <div className="w-64 flex flex-col gap-0.5 shrink-0 relative">
            <p className="font-bold text-base mb-1">{company?.name ?? '株式会社良心'}</p>
            {company?.postal_code && <p>〒{company.postal_code}</p>}
            {company?.address && <p>{company.address}</p>}
            {company?.office_name && <p>{company.office_name}</p>}
            {company?.tel && <p>TEL　：{company.tel}</p>}
            {company?.fax && <p>FAX　：{company.fax}</p>}
            {company?.email && <p>Mail　：<span className="text-blue-700 underline">{company.email}</span></p>}
            {estimate.assignee && <p>担当者　：{estimate.assignee}</p>}
            {company?.stamp_url && <img src={company.stamp_url} alt="印" className="w-16 h-16 object-contain absolute right-0 top-8" />}
          </div>
        </div>

        <div className="flex items-end gap-3 mb-6">
          <span className="font-bold text-lg">合計金額</span>
          <span className="font-bold text-3xl">¥{fmt(totals.total)}</span>
          <span className="text-xs">―（税込）</span>
        </div>

        <table className="w-full border-collapse border border-gray-800 mb-2 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-800 py-1.5 w-10">No</th>
              <th className="border border-gray-800 py-1.5">項目</th>
              <th className="border border-gray-800 py-1.5 w-24">単価</th>
              <th className="border border-gray-800 py-1.5 w-14">数量</th>
              <th className="border border-gray-800 py-1.5 w-14">単位</th>
              <th className="border border-gray-800 py-1.5 w-32">金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id}>
                <td className="border border-gray-800 py-1.5 text-center">{i + 1}</td>
                <td className="border border-gray-800 py-1.5 px-2">{item.name}</td>
                <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(item.unit_price)}</td>
                <td className="border border-gray-800 py-1.5 px-2 text-right">{item.quantity}</td>
                <td className="border border-gray-800 py-1.5 px-2 text-center">{item.unit}</td>
                <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(item.unit_price * item.quantity)}</td>
              </tr>
            ))}
            {Array.from({ length: filler }).map((_, i) => (
              <tr key={`filler-${i}`}>
                <td className="border border-gray-800 py-1.5">&nbsp;</td>
                <td className="border border-gray-800 py-1.5"></td>
                <td className="border border-gray-800 py-1.5"></td>
                <td className="border border-gray-800 py-1.5"></td>
                <td className="border border-gray-800 py-1.5"></td>
                <td className="border border-gray-800 py-1.5"></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <table className="border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-gray-800 px-6 py-1 text-center bg-gray-100">小計</td>
                <td className="border border-gray-800 px-6 py-1 text-right w-36">¥{fmt(totals.subtotal)}</td>
              </tr>
              <tr>
                <td className="border border-gray-800 px-6 py-1 text-center bg-gray-100">税額</td>
                <td className="border border-gray-800 px-6 py-1 text-right">¥{fmt(totals.taxAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {estimate.notes && (
          <div className="border border-gray-800 p-3 text-sm">
            <p className="mb-1">備考：</p>
            <p className="whitespace-pre-wrap">{estimate.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
