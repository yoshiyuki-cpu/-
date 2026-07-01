'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Estimate, EstimateItem, CompanySettings } from '@/lib/supabase'
import { calcEstimateTotals, CATEGORIES, itemAmount } from '@/lib/estimateCalc'

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP')

export default function EstimatePrintPage() {
  const { id } = useParams()
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [items, setItems] = useState<EstimateItem[]>([])
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const pageRefs = useRef<HTMLDivElement[]>([])
  pageRefs.current = []
  const registerPage = (el: HTMLDivElement | null) => {
    if (el) pageRefs.current.push(el)
  }

  useEffect(() => { load() }, [id])

  async function handleDownloadPdf() {
    if (!estimate) return
    setDownloading(true)
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ])
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    for (let i = 0; i < pageRefs.current.length; i++) {
      const canvas = await html2canvas(pageRefs.current[i], { scale: 2, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const imgHeight = Math.min(pageHeight, (canvas.height * pageWidth) / canvas.width)
      if (i > 0) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, imgHeight)
    }

    const safeName = estimate.customer_name.replace(/[\\/:*?"<>|]/g, '')
    pdf.save(`御見積書_${safeName}.pdf`)
    setDownloading(false)
  }

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

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!estimate) return <p className="text-center py-10 text-gray-500">見積りが見つかりません</p>

  const totals = calcEstimateTotals(estimate, items)
  const categoriesWithItems = CATEGORIES.filter(c => items.some(i => i.category === c.key))

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 print:px-0 print:py-0 text-gray-900 text-sm">
      <div className="no-print flex justify-end gap-2 mb-4">
        <button onClick={() => window.print()} className="bg-gray-600 text-white px-4 py-2 rounded text-sm font-medium">
          印刷する
        </button>
        <button onClick={handleDownloadPdf} disabled={downloading} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
          {downloading ? 'PDF作成中...' : 'PDFダウンロード'}
        </button>
      </div>

      {/* 表紙 */}
      <div ref={registerPage} className="bg-white p-8" style={{ pageBreakAfter: categoriesWithItems.length ? 'always' : 'auto' }}>
        <h1 className="text-center text-2xl font-bold tracking-widest mb-8">御 見 積 書</h1>

        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-lg font-bold border-b border-gray-800 pb-1 min-w-[220px]">{estimate.customer_name} 様</p>
            {estimate.customer_address && <p className="text-sm mt-1">{estimate.customer_address}</p>}
            {estimate.customer_contact && <p className="text-sm">{estimate.customer_contact}</p>}
          </div>
          <div className="text-right">
            <p className="mb-2">発行日：{estimate.issue_date}</p>
            <p className="font-bold text-base">{company?.name ?? '株式会社良心'}</p>
            {company?.postal_code && <p>〒{company.postal_code}</p>}
            {company?.address && <p>{company.address}</p>}
            {company?.office_name && <p>{company.office_name}</p>}
            {company?.tel && <p>TEL：{company.tel}{company?.fax ? `　FAX：${company.fax}` : ''}</p>}
            {company?.email && <p>Mail：{company.email}</p>}
            {estimate.assignee && <p>担当者：{estimate.assignee}</p>}
            {company?.stamp_url && <img src={company.stamp_url} alt="印" className="w-16 h-16 object-contain ml-auto mt-2" />}
          </div>
        </div>

        {estimate.project_name && <p className="font-bold mb-1">件名：{estimate.project_name}</p>}
        <p className="mb-6">下記のとおり、見積もりいたします。</p>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-6">
          {estimate.site_address && <p><span className="text-gray-500">現場住所：</span>{estimate.site_address}</p>}
          {estimate.completion_date && <p><span className="text-gray-500">完工予定日：</span>{estimate.completion_date}</p>}
          {estimate.payment_due_date && <p><span className="text-gray-500">支払期日：</span>{estimate.payment_due_date}</p>}
          {estimate.payment_terms && <p><span className="text-gray-500">支払条件：</span>{estimate.payment_terms}</p>}
          {estimate.valid_until && <p><span className="text-gray-500">見積有効期限：</span>{estimate.valid_until}</p>}
        </div>

        <div className="border-2 border-gray-800 rounded px-4 py-3 mb-8 flex justify-between items-center">
          <span className="font-bold">御見積金額</span>
          <span className="font-bold text-2xl">¥{fmt(totals.total)}-（税込）</span>
        </div>

        <table className="w-full border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="text-left py-2 font-medium">名　称</th>
              <th className="text-right py-2 font-medium w-16">数量</th>
              <th className="text-right py-2 font-medium w-16">単位</th>
              <th className="text-right py-2 font-medium w-32">単価</th>
              <th className="text-right py-2 font-medium w-32">金額</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(cat => (
              <tr key={cat.key} className="border-b border-gray-300">
                <td className="py-2">{cat.label}</td>
                <td className="text-right py-2">1</td>
                <td className="text-right py-2">式</td>
                <td className="text-right py-2">{fmt(totals.byCategory[cat.key])}</td>
                <td className="text-right py-2">{fmt(totals.byCategory[cat.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="w-64 flex flex-col gap-1">
            <div className="flex justify-between"><span>小計</span><span>¥{fmt(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span>消費税（{estimate.tax_rate}%）</span><span>¥{fmt(totals.taxAmount)}</span></div>
            <div className="flex justify-between font-bold text-base border-t border-gray-800 pt-1 mt-1">
              <span>合計金額</span><span>¥{fmt(totals.total)}</span>
            </div>
          </div>
        </div>

        {estimate.notes && (
          <div>
            <p className="text-gray-500 mb-1">備考</p>
            <p className="whitespace-pre-wrap border rounded p-3">{estimate.notes}</p>
          </div>
        )}
      </div>

      {/* 内訳明細書（大項目ごと） */}
      {categoriesWithItems.map((cat, idx) => {
        const catItems = items.filter(i => i.category === cat.key)
        const subtotal = catItems.reduce((sum, i) => sum + itemAmount(i), 0)
        const tax = Math.round(subtotal * (Number(estimate.tax_rate) / 100))
        const notedItems = catItems.filter(i => i.note)
        return (
          <div key={cat.key} ref={registerPage} className="bg-white p-8" style={{ pageBreakAfter: idx < categoriesWithItems.length - 1 ? 'always' : 'auto' }}>
            <h2 className="text-center text-xl font-bold mb-6">内訳明細書（{cat.label}）</h2>
            <table className="w-full border-collapse mb-4">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-2 font-medium w-10">No</th>
                  <th className="text-left py-2 font-medium">内　訳</th>
                  <th className="text-right py-2 font-medium w-24">単価</th>
                  <th className="text-right py-2 font-medium w-16">数量</th>
                  <th className="text-right py-2 font-medium w-16">単位</th>
                  <th className="text-right py-2 font-medium w-28">金額</th>
                </tr>
              </thead>
              <tbody>
                {catItems.map((item, i) => (
                  <tr key={item.id} className="border-b border-gray-300">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{item.name}{item.note ? `※${notedItems.indexOf(item) + 1}` : ''}</td>
                    <td className="text-right py-2">{fmt(item.unit_price)}</td>
                    <td className="text-right py-2">{item.quantity}</td>
                    <td className="text-right py-2">{item.unit}</td>
                    <td className="text-right py-2">{fmt(itemAmount(item))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end mb-6">
              <div className="w-56 flex flex-col gap-1">
                <div className="flex justify-between"><span>小計</span><span>¥{fmt(subtotal)}</span></div>
                <div className="flex justify-between"><span>税額</span><span>¥{fmt(tax)}</span></div>
              </div>
            </div>
            {notedItems.length > 0 && (
              <div>
                <p className="text-gray-500 mb-1">備考：</p>
                <div className="flex flex-col gap-1">
                  {notedItems.map((item, i) => (
                    <p key={item.id}>※{i + 1}　{item.note}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
