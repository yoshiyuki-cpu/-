'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, Estimate, EstimateItem, CompanySettings } from '@/lib/supabase'
import { calcEstimateTotals, formatDateJp, ESTIMATE_CATEGORIES, SOLO_DETAIL_CATEGORIES, COMBINED_DETAIL_CATEGORIES } from '@/lib/estimateCalc'

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP')
const MIN_ROWS = 15
const DETAIL_MIN_ROWS = 20

function FieldLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="shrink-0">{label}：</span>
      <span className="flex-1 border-b border-gray-800 min-h-[1.4em] px-1">{value}</span>
    </div>
  )
}

function EstimateHeader({ estimate, company, total }: { estimate: Estimate; company: CompanySettings | null; total: number }) {
  return (
    <>
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
          {company?.stamp_url && <img src={company.stamp_url} alt="印" crossOrigin="anonymous" className="w-16 h-16 object-contain absolute right-0 top-8" />}
        </div>
      </div>

      <div className="flex items-end gap-3 mb-6">
        <span className="font-bold text-lg">合計金額</span>
        <span className="font-bold text-3xl">¥{fmt(total)}</span>
        <span className="text-xs">―（税込）</span>
      </div>
    </>
  )
}

type DetailRow = { no: number; name: string; unitPrice?: number; quantity?: number; unit?: string; amount: number; isHeader?: boolean }

function DetailTable({ rows, minRows }: { rows: DetailRow[]; minRows: number }) {
  const filler = Math.max(0, minRows - rows.length)
  return (
    <table className="w-full border-collapse border border-gray-800 mb-2 text-sm">
      <thead>
        <tr className="bg-gray-100">
          <th className="border border-gray-800 py-1.5 w-10">No</th>
          <th className="border border-gray-800 py-1.5">内訳</th>
          <th className="border border-gray-800 py-1.5 w-20">単価</th>
          <th className="border border-gray-800 py-1.5 w-14">数量</th>
          <th className="border border-gray-800 py-1.5 w-14">単位</th>
          <th className="border border-gray-800 py-1.5 w-28">金額</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => r.isHeader ? (
          <tr key={r.no}>
            <td className="border border-gray-800 py-1.5 text-center">{r.no}</td>
            <td className="border border-gray-800 py-1.5 px-2 font-bold" colSpan={5}>{r.name}</td>
          </tr>
        ) : (
          <tr key={r.no}>
            <td className="border border-gray-800 py-1.5 text-center">{r.no}</td>
            <td className="border border-gray-800 py-1.5 px-2">{r.name}</td>
            <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(r.unitPrice ?? 0)}</td>
            <td className="border border-gray-800 py-1.5 px-2 text-right">{r.quantity}</td>
            <td className="border border-gray-800 py-1.5 px-2 text-center">{r.unit}</td>
            <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(r.amount)}</td>
          </tr>
        ))}
        {Array.from({ length: filler }).map((_, i) => (
          <tr key={`f${i}`}>
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
  )
}

function DetailFooter({ subtotal, tax }: { subtotal: number; tax: number }) {
  return (
    <div className="flex justify-end mb-4">
      <table className="border-collapse text-sm">
        <tbody>
          <tr>
            <td className="border border-gray-800 px-6 py-1 text-center bg-gray-100">小計</td>
            <td className="border border-gray-800 px-6 py-1 text-right w-36">¥{fmt(subtotal)}</td>
          </tr>
          <tr>
            <td className="border border-gray-800 px-6 py-1 text-center bg-gray-100">税額</td>
            <td className="border border-gray-800 px-6 py-1 text-right">¥{fmt(tax)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function NotesBox({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <div className="border border-gray-800 p-3 text-sm">
      <p className="mb-1">備考：</p>
      {notes.map((n, i) => <p key={i} className="whitespace-pre-wrap">{n}</p>)}
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
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const soloRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const combinedRef = useRef<HTMLDivElement>(null)

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

  async function renderPagesToPdf(refs: HTMLDivElement[], fileName: string) {
    // 通常のhtml2canvasはTailwind CSS v4が使うoklch()/lab()色関数を解析できず例外を投げるため、
    // それに対応したフォーク(html2canvas-pro)を使用する
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas-pro'),
    ])
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    for (let i = 0; i < refs.length; i++) {
      // 会社印鑑画像はSupabase Storageの別オリジンから読み込むため、useCORSを付けないと
      // キャンバスが汚染され(tainted canvas)toDataURLが例外を投げてPDF作成が固まる
      const canvas = await html2canvas(refs[i], { scale: 1.5, backgroundColor: '#ffffff', useCORS: true })
      const imgWidth = pageWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const imgData = canvas.toDataURL('image/jpeg', 0.9)
      if (i > 0) pdf.addPage()

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight)
      } else {
        // 1ページに収まらない場合はこれまで通り複数ページにスライスする
        let heightLeft = imgHeight
        let position = 0
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
        while (heightLeft > 0) {
          position = heightLeft - imgHeight
          pdf.addPage()
          pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
          heightLeft -= pageHeight
        }
      }
    }

    pdf.save(fileName)
  }

  async function handleDownloadPdf() {
    if (!estimate) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const safeName = estimate.customer_name.replace(/[\\/:*?"<>|]/g, '')
      if (estimate.layout_type === 'detailed') {
        const refs = [coverRef.current, ...SOLO_DETAIL_CATEGORIES.map(c => soloRefs.current[c]), combinedRef.current]
          .filter((el): el is HTMLDivElement => !!el)
        if (refs.length === 0) return
        await renderPagesToPdf(refs, `御見積書_${safeName}.pdf`)
      } else {
        if (!pageRef.current) return
        await renderPagesToPdf([pageRef.current], `御見積書_${safeName}.pdf`)
      }
    } catch (err) {
      console.error('PDF generation failed', err)
      setDownloadError('PDFの作成に失敗しました。「印刷する」から印刷ダイアログでPDF保存をお試しください。')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!estimate) return <p className="text-center py-10 text-gray-500">見積りが見つかりません</p>

  const totals = calcEstimateTotals(estimate, items)

  const groupedItems: Record<string, EstimateItem[]> = {}
  ESTIMATE_CATEGORIES.forEach(c => { groupedItems[c] = items.filter(i => i.category === c) })
  const combinedCats = COMBINED_DETAIL_CATEGORIES.filter(c => groupedItems[c].length > 0)
  const categoryNotes = estimate.category_notes ?? {}

  const activeSections = estimate.layout_type === 'detailed'
    ? ['cover', ...SOLO_DETAIL_CATEGORIES.filter(c => groupedItems[c].length > 0), ...(combinedCats.length > 0 ? ['combined'] : [])]
    : []
  const breakClass = (key: string) => activeSections[activeSections.length - 1] === key ? '' : 'print-page-break'

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 print:px-0 print:py-0 text-gray-900">
      <div className="no-print flex justify-between items-center gap-2 mb-4">
        <Link href={`/estimates/${id}`} className="text-blue-600 text-sm font-medium">← 編集に戻る</Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="bg-gray-600 text-white px-4 py-2 rounded text-sm font-medium">
            印刷する
          </button>
          <button onClick={handleDownloadPdf} disabled={downloading} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
            {downloading ? 'PDF作成中...' : 'PDFダウンロード'}
          </button>
        </div>
      </div>
      {downloadError && <p className="no-print text-red-500 text-sm mb-4 text-right">{downloadError}</p>}

      {estimate.layout_type === 'detailed' ? (
        <>
          <div ref={coverRef} className={`bg-white p-8 text-sm ${breakClass('cover')}`}>
            <EstimateHeader estimate={estimate} company={company} total={totals.total} />

            <table className="w-full border-collapse border border-gray-800 mb-2 text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-800 py-1.5 w-10">No</th>
                  <th className="border border-gray-800 py-1.5">名称</th>
                  <th className="border border-gray-800 py-1.5 w-14">数量</th>
                  <th className="border border-gray-800 py-1.5 w-14">単位</th>
                  <th className="border border-gray-800 py-1.5 w-24">単価</th>
                  <th className="border border-gray-800 py-1.5 w-32">金額</th>
                </tr>
              </thead>
              <tbody>
                {ESTIMATE_CATEGORIES.filter(c => groupedItems[c].length > 0).map((c, i) => {
                  const amount = calcEstimateTotals(estimate, groupedItems[c]).subtotal
                  return (
                    <tr key={c}>
                      <td className="border border-gray-800 py-1.5 text-center">{i + 1}</td>
                      <td className="border border-gray-800 py-1.5 px-2">{c}</td>
                      <td className="border border-gray-800 py-1.5 px-2 text-right">1</td>
                      <td className="border border-gray-800 py-1.5 px-2 text-center">式</td>
                      <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(amount)}</td>
                      <td className="border border-gray-800 py-1.5 px-2 text-right">{fmt(amount)}</td>
                    </tr>
                  )
                })}
                {Array.from({ length: Math.max(0, MIN_ROWS - ESTIMATE_CATEGORIES.filter(c => groupedItems[c].length > 0).length) }).map((_, i) => (
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

          {SOLO_DETAIL_CATEGORIES.filter(c => groupedItems[c].length > 0).map(category => {
            const catItems = groupedItems[category]
            const catTotals = calcEstimateTotals(estimate, catItems)
            const rows: DetailRow[] = catItems.map((it, i) => ({
              no: i + 1, name: it.name, unitPrice: it.unit_price, quantity: it.quantity, unit: it.unit, amount: it.unit_price * it.quantity,
            }))
            return (
              <div key={category} ref={el => { soloRefs.current[category] = el }} className={`bg-white p-8 text-sm ${breakClass(category)}`}>
                <h1 className="text-center text-2xl font-bold tracking-widest mb-2">内訳明細書</h1>
                <h2 className="text-center text-lg font-bold mb-4">{category}</h2>
                <DetailTable rows={rows} minRows={DETAIL_MIN_ROWS} />
                <DetailFooter subtotal={catTotals.subtotal} tax={catTotals.taxAmount} />
                <NotesBox notes={categoryNotes[category] ? [categoryNotes[category]] : []} />
              </div>
            )
          })}

          {combinedCats.length > 0 && (
            <div ref={combinedRef} className="bg-white p-8 text-sm">
              <h1 className="text-center text-2xl font-bold tracking-widest mb-4">内訳明細書</h1>
              <DetailTable
                rows={(() => {
                  const rows: DetailRow[] = []
                  let no = 0
                  combinedCats.forEach(c => {
                    no += 1
                    rows.push({ no, name: c, amount: 0, isHeader: true })
                    groupedItems[c].forEach(it => {
                      no += 1
                      rows.push({ no, name: it.name, unitPrice: it.unit_price, quantity: it.quantity, unit: it.unit, amount: it.unit_price * it.quantity })
                    })
                  })
                  return rows
                })()}
                minRows={DETAIL_MIN_ROWS}
              />
              <DetailFooter
                subtotal={calcEstimateTotals(estimate, combinedCats.flatMap(c => groupedItems[c])).subtotal}
                tax={calcEstimateTotals(estimate, combinedCats.flatMap(c => groupedItems[c])).taxAmount}
              />
              <NotesBox notes={combinedCats.map(c => categoryNotes[c]).filter((n): n is string => !!n)} />
            </div>
          )}
        </>
      ) : (
        <div ref={pageRef} className="bg-white p-8 text-sm">
          <EstimateHeader estimate={estimate} company={company} total={totals.total} />

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
              {Array.from({ length: Math.max(0, MIN_ROWS - items.length) }).map((_, i) => (
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
      )}
    </div>
  )
}
