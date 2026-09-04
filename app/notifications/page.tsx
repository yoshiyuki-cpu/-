'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Target = { id: number; name: string; is_foreman: boolean; is_google_ads: boolean; is_x_pr: boolean }

// その人がどのリマインダーを受け取るかを、名前の横に出すための肩書き
function roleLabel(t: Target) {
  const roles: string[] = []
  if (t.is_foreman) roles.push('職長')
  if (t.is_google_ads || t.is_x_pr) roles.push('集客担当')
  return roles.join('・')
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export default function NotificationsPage() {
  const [targets, setTargets] = useState<Target[]>([])
  const [workerId, setWorkerId] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error' | 'unsupported'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  // 外部連携の接続確認
  const [slackResult, setSlackResult] = useState<string | null>(null)
  const [googleResult, setGoogleResult] = useState<string | null>(null)
  const [testing, setTesting] = useState<'slack' | 'google' | null>(null)

  async function testSlack() {
    setTesting('slack'); setSlackResult(null)
    try {
      const r = await fetch('/api/slack-test', { method: 'POST' }).then(x => x.json())
      setSlackResult(r.ok ? 'Slack に送りました。チャンネルを確認してください。'
        : !r.configured ? 'まだ設定されていません。Vercel に SLACK_WEBHOOK_URL を入れると使えます。'
        : `送れませんでした：${r.message}`)
    } catch { setSlackResult('送れませんでした。') }
    setTesting(null)
  }

  async function testGoogle() {
    setTesting('google'); setGoogleResult(null)
    try {
      const r = await fetch('/api/google-calendar').then(x => x.json())
      const items: { date: string; summary: string }[] = r.items ?? []
      setGoogleResult(r.ok
        ? `つながっています。直近の予定：${items.length === 0 ? 'なし' : items.map(i => `${i.date} ${i.summary}`).join(' / ')}`
        : !r.configured ? 'まだ設定されていません。Vercel に GOOGLE_SERVICE_ACCOUNT_JSON と GOOGLE_CALENDAR_ID を入れると使えます。'
        : `つながりません：${r.message}`)
    } catch { setGoogleResult('確認できませんでした。') }
    setTesting(null)
  }

  useEffect(() => {
    // 職長だけでなく、夕方の広報リマインダーを受け取る集客担当も選べるようにする
    supabase.from('workers')
      .select('id, name, is_foreman, is_google_ads, is_x_pr')
      .or('is_foreman.eq.true,is_google_ads.eq.true,is_x_pr.eq.true')
      .order('name')
      .then(({ data }) => setTargets(data ?? []))
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
        <p className="text-sm text-gray-600 mb-3">
          ご自身の名前を選んで「通知を有効にする」を押すと、この端末にリマインダーが届きます。
        </p>
        <ul className="text-xs text-gray-500 mb-4 space-y-0.5">
          <li>・職長 … 朝7:50「議事録・KY活動」／夕方17:30「工事台帳記入・写真貼り付け」</li>
          <li>・集客担当 … 夕方17:30「Google広告・Xの広報」</li>
        </ul>

        {status === 'unsupported' && (
          <p className="text-sm text-red-500">このブラウザはプッシュ通知に対応していません。</p>
        )}

        {status !== 'unsupported' && (
          <>
            <label className="block text-sm font-medium mb-1">お名前</label>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3"
              value={workerId} onChange={e => setWorkerId(e.target.value)}>
              <option value="">選択してください</option>
              {targets.map(t => (
                <option key={t.id} value={t.id}>{t.name}（{roleLabel(t)}）</option>
              ))}
            </select>
            {targets.length === 0 && (
              <p className="text-xs text-gray-400 mb-3">
                職長・集客担当として登録された作業員がいません。マスタ管理の作業員タブから設定してください。
              </p>
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

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-4">
        <h2 className="font-bold text-gray-700 mb-1">外部連携</h2>
        <p className="text-xs text-gray-500 mb-3">
          設定は Vercel の環境変数で行います。ここでは「つながっているか」だけ確認できます。
        </p>

        <div className="border border-gray-100 rounded-xl p-3 mb-2">
          <p className="text-sm font-medium">Slack</p>
          <p className="text-xs text-gray-500 mb-2">段取りの確定・明日の予定・振り返りの記入をチャンネルに流します。</p>
          <button onClick={testSlack} disabled={testing !== null}
            className="w-full border border-blue-600 text-blue-600 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            {testing === 'slack' ? '送信中...' : 'Slack にテスト送信'}
          </button>
          {slackResult && <p className="text-xs mt-2 text-gray-700">{slackResult}</p>}
        </div>

        <div className="border border-gray-100 rounded-xl p-3">
          <p className="text-sm font-medium">Google カレンダー</p>
          <p className="text-xs text-gray-500 mb-2">共有カレンダーの予定（着工・夜勤・見積り）を Google カレンダーにも写します。</p>
          <button onClick={testGoogle} disabled={testing !== null}
            className="w-full border border-blue-600 text-blue-600 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            {testing === 'google' ? '確認中...' : 'つながっているか確認'}
          </button>
          {googleResult && <p className="text-xs mt-2 text-gray-700">{googleResult}</p>}
        </div>
      </section>
    </div>
  )
}
