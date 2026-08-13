'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Foreman = { id: number; name: string }

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export default function NotificationsPage() {
  const [foremen, setForemen] = useState<Foreman[]>([])
  const [workerId, setWorkerId] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error' | 'unsupported'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    supabase.from('workers').select('id, name').eq('is_foreman', true).order('name')
      .then(({ data }) => setForemen(data ?? []))
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
    }
  }, [])

  async function enableNotifications() {
    if (!workerId) return
    setStatus('working')
    setErrorMsg('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('error')
        setErrorMsg('通知が許可されませんでした。ブラウザの設定から通知を許可してください。')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) {
        setStatus('error')
        setErrorMsg('通知機能が設定されていません（管理者に連絡してください）。')
        return
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: Number(workerId), subscription: subscription.toJSON() }),
      })
      if (!res.ok) throw new Error('save failed')

      setStatus('done')
    } catch (e) {
      console.error(e)
      setStatus('error')
      setErrorMsg('通知の設定中にエラーが発生しました。もう一度お試しください。')
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">通知設定</h1>
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-sm text-gray-600 mb-4">
          この端末に、朝7:50「議事録・KY活動」、夕方17:30「工事台帳記入・写真貼り付け」のリマインダー通知を送ります。
          ご自身の名前を選んで「通知を有効にする」を押してください。
        </p>

        {status === 'unsupported' && (
          <p className="text-sm text-red-500">このブラウザはプッシュ通知に対応していません。</p>
        )}

        {status !== 'unsupported' && (
          <>
            <label className="block text-sm font-medium mb-1">お名前</label>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3"
              value={workerId} onChange={e => setWorkerId(e.target.value)}>
              <option value="">選択してください</option>
              {foremen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {foremen.length === 0 && (
              <p className="text-xs text-gray-400 mb-3">職長として登録された作業員がいません。マスタ管理から設定してください。</p>
            )}
            <button onClick={enableNotifications} disabled={!workerId || status === 'working'}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">
              {status === 'working' ? '設定中...' : '通知を有効にする'}
            </button>
            {status === 'done' && <p className="text-sm text-green-600 mt-3">通知を有効にしました。</p>}
            {status === 'error' && <p className="text-sm text-red-500 mt-3">{errorMsg}</p>}
          </>
        )}
      </section>
    </div>
  )
}
