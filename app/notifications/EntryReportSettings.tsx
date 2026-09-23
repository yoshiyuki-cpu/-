'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'

// 通知設定の「夕方の記入状況の報告」。送り先は社長と、印を付けた人（難波君）だけ。
// 社長は作業員の表に居ないので、LINE の連携は app_settings に持つ。
const OWNER_LINE_USER_ID_KEY = 'owner_line_user_id'
const OWNER_LINE_LINK_CODE_KEY = 'owner_line_link_code'

type W = { id: number; name: string; line_user_id: string | null; email: string | null; receives_entry_report?: boolean; in_dispatch?: boolean }

export default function EntryReportSettings() {
  const [workers, setWorkers] = useState<W[]>([])
  const [ownerLine, setOwnerLine] = useState<string | null>(null)
  const [ownerCode, setOwnerCode] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const [message, setMessage] = useState('')

  async function load() {
    const [{ data: wk }, { data: st }] = await Promise.all([
      supabase.from('workers').select('*').order('name'),
      supabase.from('app_settings').select('key, value').in('key', [OWNER_LINE_USER_ID_KEY, OWNER_LINE_LINK_CODE_KEY, REFLECTION_NOTIFY_EMAIL_KEY]),
    ])
    setWorkers((wk ?? []) as W[])
    const v = (k: string) => (st ?? []).find((s: { key: string }) => s.key === k)?.value ?? null
    setOwnerLine(v(OWNER_LINE_USER_ID_KEY)); setOwnerCode(v(OWNER_LINE_LINK_CODE_KEY)); setOwnerEmail(v(REFLECTION_NOTIFY_EMAIL_KEY))
  }
  useEffect(() => { load() }, [])

  const receivers = workers.filter(w => w.receives_entry_report === true)
  const candidates = workers.filter(w => w.receives_entry_report !== true && w.in_dispatch !== false)

  async function setReceiver(id: number, on: boolean) {
    setMessage('')
    const { error } = await supabase.from('workers').update({ receives_entry_report: on }).eq('id', id)
    if (error) {
      setMessage(error.message.includes('receives_entry_report')
        ? '準備がまだです。Supabaseで supabase-schema-morning-gate.sql を実行してください。'
        : '保存できませんでした。もう一度お試しください。')
      return
    }
    setAdding('')
    await load()
  }

  async function issueOwnerCode() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    await supabase.from('app_settings').upsert({ key: OWNER_LINE_LINK_CODE_KEY, value: code, updated_at: new Date().toISOString() })
    await load()
  }

  async function unlinkOwner() {
    await supabase.from('app_settings').upsert({ key: OWNER_LINE_USER_ID_KEY, value: null, updated_at: new Date().toISOString() })
    await load()
  }

  async function showPreview() {
    setBusy('preview'); setMessage('')
    try {
      const r = await fetch('/api/entry-report').then(x => x.json())
      setPreview(r.text ?? '')
    } catch { setMessage('文面を作れませんでした。') }
    setBusy(null)
  }

  async function sendNow() {
    setBusy('send'); setMessage('')
    try {
      const r = await fetch('/api/entry-report', { method: 'POST' }).then(x => x.json())
      setMessage([
        r.sentTo?.length ? `送りました：${r.sentTo.join('、')}` : '誰にも送れませんでした。',
        r.skipped?.length ? `送れなかった人：${r.skipped.join('、')}` : '',
      ].filter(Boolean).join('\n'))
    } catch { setMessage('送れませんでした。') }
    setBusy(null)
  }

  const channel = (w: W) => (w.line_user_id ? 'LINE' : w.email ? 'メール' : 'LINE・メール未設定')

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-4">
      <h2 className="font-bold text-gray-700 mb-1">夕方の記入状況の報告</h2>
      <p className="text-xs text-gray-500 mb-3">
        毎日19時30分（日曜は休み）に、現場ごとの KY活動・議事録・人工・処分代が入っているかをまとめて送ります。
        送り先は社長と、下に入れた人だけです。
      </p>

      <div className="border border-gray-100 rounded-xl p-3 mb-2">
        <p className="text-sm font-medium">社長</p>
        {ownerLine ? (
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-emerald-700">LINE で受け取ります ✓</span>
            <button onClick={unlinkOwner} className="text-xs text-gray-500 underline">連携を外す</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mt-1">
              {ownerEmail ? `今はメール（${ownerEmail}）で送ります。` : 'LINE もメールも未設定なので、今は届きません。'}
              LINE で受け取るには、下のコードを良心の LINE 公式アカウントとのトークに送ってください。
            </p>
            {ownerCode ? (
              <p className="font-mono text-lg font-bold text-amber-700 mt-2">{ownerCode}</p>
            ) : (
              <button onClick={issueOwnerCode}
                className="mt-2 w-full border border-blue-600 text-blue-600 py-2 rounded-lg text-sm font-medium">
                LINE の連携コードを発行する
              </button>
            )}
          </>
        )}
      </div>

      <div className="border border-gray-100 rounded-xl p-3 mb-3">
        <p className="text-sm font-medium mb-1">ほかに受け取る人</p>
        {receivers.length === 0 && <p className="text-xs text-gray-400 mb-2">まだいません。</p>}
        <div className="flex flex-col gap-1 mb-2">
          {receivers.map(w => (
            <div key={w.id} className="flex items-center justify-between py-1.5">
              <span className="text-sm">{w.name}<span className="text-xs text-gray-400 ml-2">{channel(w)}</span></span>
              <button onClick={() => setReceiver(w.id, false)} className="text-xs text-gray-500 underline px-2 py-1">外す</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <select id="entry-report-add" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={adding} onChange={e => setAdding(e.target.value)}>
            <option value="">追加する人を選ぶ</option>
            {candidates.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={() => adding && setReceiver(Number(adding), true)} disabled={!adding}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">追加</button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">LINE を連携している人は LINE、していない人はメールで届きます。</p>
      </div>

      <div className="flex gap-2">
        <button onClick={showPreview} disabled={busy !== null}
          className="flex-1 border border-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
          {busy === 'preview' ? '作成中...' : '今の文面を見る'}
        </button>
        <button onClick={sendNow} disabled={busy !== null}
          className="flex-1 border border-blue-600 text-blue-600 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
          {busy === 'send' ? '送信中...' : '今すぐ送る'}
        </button>
      </div>
      {message && <p className="text-xs mt-2 text-gray-700 whitespace-pre-wrap">{message}</p>}
      {preview !== null && (
        <pre className="mt-2 text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-sans">{preview}</pre>
      )}
    </section>
  )
}
