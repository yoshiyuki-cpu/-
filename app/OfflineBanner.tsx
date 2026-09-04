'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useOfflineQueue, flushQueue, removeQueued } from '@/lib/offlineQueue'

// どの画面にいても、未送信の入力があれば上に出す。つながった時に自動で送る。
// あわせて service worker を全画面で登録し、一度開いた画面を圏外でも開けるようにする
export default function OfflineBanner() {
  const queue = useOfflineQueue()
  const [online, setOnline] = useState(true)
  const [sending, setSending] = useState(false)
  const [lastSent, setLastSent] = useState<number | null>(null)

  useEffect(() => {
    setOnline(navigator.onLine)
    const up = async () => { setOnline(true); await send() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    if (navigator.onLine) send()
    // 圏外でも画面を開けるように。失敗しても何も起きないだけ
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  async function send() {
    setSending(true)
    const r = await flushQueue(supabase)
    setSending(false)
    if (r.sent > 0) { setLastSent(r.sent); setTimeout(() => setLastSent(null), 4000) }
  }

  const pending = queue.filter(q => !q.error)
  const failed = queue.filter(q => q.error)
  if (queue.length === 0 && online && lastSent === null) return null

  return (
    <div className="no-print sticky top-0 z-20 max-w-2xl mx-auto px-4 pt-2">
      {lastSent !== null && queue.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-sm">
          貯めていた {lastSent} 件を送りました ✓
        </div>
      )}
      {!online && (
        <div className="bg-gray-800 text-white rounded-xl px-3 py-2 text-sm mb-1">
          圏外です。入力はこの端末に貯まり、つながったら自動で送ります。
        </div>
      )}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2">
          <span>未送信 <b>{pending.length}</b> 件（{pending.map(p => p.label).slice(0, 2).join('、')}{pending.length > 2 ? ' ほか' : ''}）</span>
          <button onClick={send} disabled={sending || !online}
            className="shrink-0 text-xs bg-amber-600 text-white rounded-full px-3 py-1 disabled:opacity-40">
            {sending ? '送信中' : '今すぐ送る'}
          </button>
        </div>
      )}
      {failed.map(f => (
        <div key={f.id} className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm mt-1">
          <div className="flex justify-between items-start gap-2">
            <span>送れませんでした：{f.label}<br /><span className="text-[11px] text-red-600">{f.error}</span></span>
            <button onClick={() => removeQueued(f.id)} className="shrink-0 text-xs text-red-700 underline">消す</button>
          </div>
        </div>
      ))}
    </div>
  )
}
