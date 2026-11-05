'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BillingMe, OWNER_MEMBER_ID, canConfirm, useBillingSession } from '@/lib/billingSession'
import SalesTab from './SalesTab'
import InvoicesTab from './InvoicesTab'
import ClientsTab from './ClientsTab'
import SettingsTab from './SettingsTab'

// 売上と請求書（2026-11 社長の依頼）。工事代金を作業員全員には見せないため、
// 社長が指定した人だけが合言葉で入る。権限は「見るだけ／記入まで／確定まで」の3段階。
type Tab = 'sales' | 'invoices' | 'clients' | 'settings'

function Login({ session }: { session: ReturnType<typeof useBillingSession> }) {
  const [id, setId] = useState(String(OWNER_MEMBER_ID))
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const people = session.members.filter(m => m.active)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!passcode.trim() || busy) return
    setBusy(true); setMessage('')
    try {
      await session.login(Number(id), passcode)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'もう一度お試しください。')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <p className="text-sm text-gray-600">売上は、社長が指定した人だけが見られます。名前を選んで合言葉を入れてください。</p>
      <label className="text-sm font-medium">名前
        <select value={id} onChange={e => setId(e.target.value)}
          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
          <option value={OWNER_MEMBER_ID}>社長</option>
          {people.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">合言葉
        <input type="password" autoComplete="off" value={passcode} onChange={e => setPasscode(e.target.value)}
          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </label>
      {message && <p className="text-sm text-red-600">{message}</p>}
      <button disabled={busy || !passcode.trim()}
        className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
        {busy ? '確認中...' : '入る'}
      </button>
    </form>
  )
}

function Screen({ me, onLogout, onMembersChanged }: { me: BillingMe; onLogout: () => void; onMembersChanged: () => void }) {
  const params = useSearchParams()
  const initial = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(initial && ['sales', 'invoices', 'clients', 'settings'].includes(initial) ? initial : 'sales')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'sales', label: '売上' },
    { key: 'invoices', label: '請求書' },
    { key: 'clients', label: '元請' },
    ...(canConfirm(me) ? [{ key: 'settings' as Tab, label: '設定' }] : []),
  ]
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">{me.name} さんで入っています</p>
        <button onClick={onLogout} className="text-xs text-gray-600 border border-gray-200 bg-white rounded-lg px-2.5 py-1.5">この端末から出る</button>
      </div>
      <div className="flex gap-1.5 mb-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition ${tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sales' && <SalesTab me={me} />}
      {tab === 'invoices' && <InvoicesTab me={me} />}
      {tab === 'clients' && <ClientsTab me={me} />}
      {tab === 'settings' && canConfirm(me) && <SettingsTab me={me} onMembersChanged={onMembersChanged} />}
    </div>
  )
}

export default function BillingPage() {
  const session = useBillingSession()
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">売上・請求書</h1>
      <p className="text-xs text-gray-500 mb-4">売上を入れておくと、毎月1日の朝に先月分の請求書の下書きができます。</p>
      {session.loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!session.loading && session.message && (
        <p className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">{session.message}</p>
      )}
      {!session.loading && !session.message && !session.me && <Login session={session} />}
      {!session.loading && !session.message && session.me && (
        <Suspense fallback={<p className="text-center py-10 text-gray-500">読み込み中...</p>}>
          <Screen me={session.me} onLogout={session.logout} onMembersChanged={session.reload} />
        </Suspense>
      )}
    </div>
  )
}
