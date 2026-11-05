'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { jstToday } from '@/lib/date'
import { BillingClient, BillingEntry, BillingInvoice, createDraftsForMonth, fetchClients, fetchEntries, fetchInvoices } from '@/lib/billing'
import { calcTotals, prevMonth } from '@/lib/billingCalc'
import { BillingMe, canEdit } from '@/lib/billingSession'

const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${y}年${mm}月` }

export default function InvoicesTab({ me }: { me: BillingMe }) {
  // 月初に見るものなので、最初は先月を出す
  const [month, setMonth] = useState(() => prevMonth(jstToday().slice(0, 7)))
  const [invoices, setInvoices] = useState<BillingInvoice[]>([])
  const [clients, setClients] = useState<BillingClient[]>([])
  const [entries, setEntries] = useState<BillingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async (m: string) => {
    try {
      const [i, c, e] = await Promise.all([fetchInvoices(m), fetchClients(), fetchEntries()])
      setInvoices(i); setClients(c); setEntries(e)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込めませんでした。')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load(month) })
    return () => { active = false }
  }, [month, load])

  const monthEntries = entries.filter(e => e.billing_month === month && e.client_id)
  const withInvoice = new Set(invoices.map(i => i.client_id))
  const waitingClients = [...new Set(monthEntries.map(e => e.client_id))].filter(id => !withInvoice.has(id)).length
  const unassigned = entries.filter(e => !e.billing_month || !e.client_id).length

  async function createDrafts() {
    setBusy(true); setMessage('')
    try {
      const r = await createDraftsForMonth(month)
      setMessage(r.created > 0 ? `下書きを${r.created}通作りました。` : '新しく作る下書きはありませんでした。')
      await load(month)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '下書きを作れませんでした。')
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-medium">請求月
        <input type="month" value={month} onChange={e => { if (e.target.value) { setLoading(true); setMonth(e.target.value) } }}
          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </label>
      {message && <p className="text-sm text-blue-800 bg-blue-50 rounded-xl px-3 py-2">{message}</p>}
      {unassigned > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          請求月か元請が未選択の売上が {unassigned} 件あり、請求書に載っていません。「売上」のタブで選んでください。
        </p>
      )}
      {canEdit(me) && waitingClients > 0 && (
        <button onClick={createDrafts} disabled={busy} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
          {busy ? '作成中...' : `${monthLabel(month)}の下書きを作る（${waitingClients}社）`}
        </button>
      )}
      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && invoices.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-6">{monthLabel(month)}の請求書はまだありません。毎月1日の朝に、先月分の下書きが自動でできます。</p>
      )}
      <div className="flex flex-col gap-2">
        {!loading && invoices.map(inv => {
          const name = inv.snapshot?.client.name ?? clients.find(c => c.id === inv.client_id)?.name ?? '元請 不明'
          const total = inv.snapshot?.totals.total ?? calcTotals(monthEntries.filter(e => e.client_id === inv.client_id)).total
          return (
            <Link key={inv.id} href={`/billing/invoices/${inv.id}`}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">{name}</p>
                <p className={`text-xs mt-0.5 font-medium ${inv.status === 'confirmed' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {inv.status === 'confirmed' ? '確定済み' : '下書き（未確定）'}
                </p>
              </div>
              <p className="text-sm font-bold shrink-0">{total.toLocaleString()}円</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
