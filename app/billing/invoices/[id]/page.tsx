'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'
import {
  BillingClient, BillingEntry, BillingInvoice, BillingSettings, confirmInvoice, fetchClients, fetchInvoice,
  fetchInvoiceLines, fetchSettings, unlockInvoice, updateInvoice,
} from '@/lib/billing'
import { canConfirm, canEdit, useBillingSession } from '@/lib/billingSession'
import InvoiceSheet, { pageCount, SheetData } from './InvoiceSheet'

const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${y}年${mm}月` }
const INPUT = 'mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const session = useBillingSession()
  const me = session.me
  const [invoice, setInvoice] = useState<BillingInvoice | null>(null)
  const [client, setClient] = useState<BillingClient | null>(null)
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [lines, setLines] = useState<BillingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([])

  const load = useCallback(async () => {
    try {
      const [inv, clients, s] = await Promise.all([fetchInvoice(Number(id)), fetchClients(), fetchSettings()])
      setInvoice(inv); setSettings(s)
      const c = clients.find(x => x.id === inv?.client_id) ?? null
      setClient(c)
      setLines(inv && c ? await fetchInvoiceLines(c.id, inv.billing_month) : [])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込めませんでした。')
    }
    setLoading(false)
  }, [id])

  const signedIn = !!me
  useEffect(() => {
    if (!signedIn) return
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false }
  }, [signedIn, load])

  if (session.loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!me) return (
    <p className="text-sm text-center py-10 text-gray-600">
      {session.message || <><Link href="/billing" className="text-blue-600 underline">売上・請求書</Link> から合言葉を入れて入ってください。</>}
    </p>
  )
  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!invoice) return <p className="text-sm text-center py-10 text-gray-600">{message || '請求書が見つかりませんでした。'}</p>

  const confirmed = invoice.status === 'confirmed'
  const snap = invoice.snapshot
  const data: SheetData | null = confirmed && snap
    ? { client: snap.client, settings: snap.settings, invoiceNo: invoice.invoice_no, issueDate: invoice.issue_date, dueDate: invoice.due_date, note: invoice.note, lines: snap.lines }
    : client ? { client, settings, invoiceNo: invoice.invoice_no, issueDate: invoice.issue_date, dueDate: invoice.due_date, note: invoice.note, lines } : null
  const pages = pageCount(data?.lines.length ?? 0)
  const editable = canEdit(me) && !confirmed
  const lateAdded = confirmed && snap ? lines.filter(l => !snap.lines.some(s => s.id === l.id)).length : 0

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true); setMessage('')
    try {
      await fn()
      await load()
      setMessage(done)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
    setBusy(false)
  }

  function saveField(values: Partial<BillingInvoice>) {
    if (!invoice) return
    run(() => updateInvoice(invoice.id, values), '保存しました。')
  }

  function confirmNow() {
    if (!invoice || !client || !me) return
    if (!settings?.issuer_name || !settings.account_number) { setMessage('「設定」のタブで、自社の情報と振込先を入れてから確定してください。'); return }
    if (!confirm('この内容で確定しますか？確定すると売上や請求書を直せなくなります。')) return
    run(async () => {
      await confirmInvoice(invoice, client, me.name)
      logAction(supabase, 'complete', 'billing_invoices', invoice.id, `${monthLabel(invoice.billing_month)}分の請求書を確定した`)
    }, '確定しました。PDFを保存して元請へ送ってください。')
  }

  function unlockNow() {
    if (!invoice) return
    if (!confirm('確定を解除しますか？')) return
    run(async () => {
      await unlockInvoice(invoice.id)
      logAction(supabase, 'reopen', 'billing_invoices', invoice.id, `${monthLabel(invoice.billing_month)}分の請求書の確定を解除した`)
    }, '確定を解除しました。')
  }

  async function savePdf() {
    if (!data || !invoice) return
    setSaving(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')])
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      for (let i = 0; i < pages; i++) {
        const el = sheetRefs.current[i]
        if (!el) continue
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
        if (i > 0) pdf.addPage('a4', 'landscape')
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210)
      }
      const [y, m] = invoice.billing_month.split('-')
      pdf.save(`良心　${data.client.name}請求書${y}${m}.pdf`)
    } catch {
      setMessage('PDFを作れませんでした。「印刷」からPDFとして保存してください。')
    }
    setSaving(false)
  }

  return (
    <div>
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } .invoice-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print flex flex-col gap-3 mb-4">
        <Link href="/billing?tab=invoices" className="text-sm text-blue-600">← 請求書の一覧へ</Link>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold break-words">{data?.client.name ?? '元請 不明'}</h1>
          <span className={`text-sm font-medium shrink-0 ${confirmed ? 'text-emerald-700' : 'text-amber-700'}`}>{confirmed ? '確定済み' : '下書き'}</span>
        </div>
        <p className="text-xs text-gray-500">{monthLabel(invoice.billing_month)}分{confirmed && invoice.confirmed_by ? `・${invoice.confirmed_by} さんが確定` : ''}</p>
        {message && <p className="text-sm text-blue-800 bg-blue-50 rounded-xl px-3 py-2">{message}</p>}
        {lateAdded > 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">確定のあとに入った売上が{lateAdded}件あります。載せるには確定を解除してください。</p>
        )}
        {!data && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">元請の情報が見つかりません。「元請」のタブを確認してください。</p>}

        {editable && (
          // 値が変わるたびに読み直すと入力中に動くので、欄を離れたときに保存する
          <div key={`${invoice.invoice_no}-${invoice.issue_date}-${invoice.due_date}-${invoice.note}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">請求No.
              <input defaultValue={invoice.invoice_no} onBlur={e => { const v = e.target.value.trim(); if (v && v !== invoice.invoice_no) saveField({ invoice_no: v }) }} className={INPUT} />
            </label>
            <label className="text-sm font-medium">請求日
              <input type="date" defaultValue={invoice.issue_date} onBlur={e => { if (e.target.value && e.target.value !== invoice.issue_date) saveField({ issue_date: e.target.value }) }} className={INPUT} />
            </label>
            <label className="text-sm font-medium">お支払期限
              <input type="date" defaultValue={invoice.due_date} onBlur={e => { if (e.target.value && e.target.value !== invoice.due_date) saveField({ due_date: e.target.value }) }} className={INPUT} />
            </label>
            <label className="text-sm font-medium col-span-2">備考
              <textarea defaultValue={invoice.note ?? ''} rows={2} onBlur={e => { const v = e.target.value.trim() || null; if (v !== invoice.note) saveField({ note: v }) }} className={INPUT} />
            </label>
            <Link href="/billing?tab=sales" className="col-span-2 text-sm text-blue-600 underline">明細を直すときは「売上」のタブから</Link>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={savePdf} disabled={saving || !data} className="flex-1 bg-blue-600 text-white py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-40 whitespace-nowrap">{saving ? '作成中...' : 'PDFで保存'}</button>
          <button onClick={() => window.print()} disabled={!data} className="flex-1 border border-gray-300 text-gray-700 py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-40">印刷</button>
          {canConfirm(me) && !confirmed && (
            <button onClick={confirmNow} disabled={busy || !client || lines.length === 0} className="flex-1 bg-emerald-600 text-white py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-40">確定する</button>
          )}
          {canConfirm(me) && confirmed && (
            <button onClick={unlockNow} disabled={busy} className="flex-1 border border-gray-300 text-gray-700 py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-40">確定を解除</button>
          )}
        </div>
        <p className="text-xs text-gray-500">スマホでは請求書を横に動かして見られます。元請への送信は自動では行いません。</p>
      </div>

      {data && (
        <div className="overflow-x-auto print:overflow-visible -mx-4 px-4 print:m-0 print:p-0">
          <div className="flex flex-col gap-4 print:gap-0" style={{ width: 1120 }}>
            {Array.from({ length: pages }).map((_, i) => (
              <div key={i} className={`shadow-sm print:shadow-none ${i < pages - 1 ? 'print-page-break' : ''}`}>
                <InvoiceSheet ref={el => { sheetRefs.current[i] = el }} data={data} page={i} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
