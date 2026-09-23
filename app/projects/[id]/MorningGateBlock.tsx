'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { GateState, gateUnlockKey, gateMissing } from '@/lib/morningGate'
import { hashPasscode, ADMIN_SCOPE, ADMIN_PASSCODE_KEY } from '@/lib/passcode'
import { logAction } from '@/lib/audit'

// 入力画面で、朝の KY活動・議事録・道具の確認が済むまで人工・処分代の欄の代わりに出す案内。
// 日付は変えられる（前の日の入れ忘れを入れるため。その日の KY・議事録があれば入れられる）。
export default function MorningGateBlock({
  projectId, projectName, gate, date, onDateChange, onUnlocked,
}: {
  projectId: number
  projectName: string
  gate: GateState
  date: string
  onDateChange: (d: string) => void
  onUnlocked: () => void
}) {
  const [showUnlock, setShowUnlock] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [, m, d] = date.split('-').map(Number)

  async function unlock() {
    if (!passcode.trim()) return
    setBusy(true); setMsg('')
    const { data } = await supabase.from('app_settings').select('value').eq('key', ADMIN_PASSCODE_KEY).limit(1)
    const saved = (data?.[0] as { value?: string } | undefined)?.value
    if (!saved) {
      setBusy(false)
      setMsg('社長の合言葉がまだ決まっていません。マスタ → 振り返り で社長の合言葉を決めてください。')
      return
    }
    if (await hashPasscode(ADMIN_SCOPE, passcode.trim()) !== saved) {
      setBusy(false)
      setMsg('合言葉が違います。')
      return
    }
    const stamp = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date())
    const { error } = await supabase.from('app_settings')
      .upsert({ key: gateUnlockKey(projectId, date), value: `社長（${stamp}）`, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) { setMsg('解除できませんでした。もう一度お試しください。'); return }
    logAction(supabase, 'edit', 'projects', projectId, `${projectName} の ${m}/${d} の入力制限を解除した（${gateMissing(gate)}なし）`)
    setPasscode('')
    onUnlocked()
  }

  const row = (done: boolean, label: string, href: string) => (
    <Link href={href}
      className={`flex items-center justify-between rounded-xl border px-3 py-3 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-white'}`}>
      <span className="text-base font-medium">{label}</span>
      <span className={`text-sm font-bold ${done ? 'text-emerald-700' : 'text-amber-700'}`}>{done ? '登録済み ✓' : 'まだ →'}</span>
    </Link>
  )

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <label htmlFor="gate-date" className="block text-sm font-medium mb-1">日付</label>
        <input id="gate-date" type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white"
          value={date} onChange={e => onDateChange(e.target.value)} />
      </div>
      <div>
        <p className="font-bold text-amber-900">{m}/{d} の{gateMissing(gate)}がまだです</p>
        <p className="text-sm text-amber-900 mt-1">
          朝の KY活動・議事録{gate.toolsRequired ? '・道具の確認' : ''}が済むと、人工・処分代を入力できるようになります。
        </p>
      </div>
      {row(gate.ky, 'KY活動（写真）', `/projects/${projectId}/ky`)}
      {row(gate.minutes, '議事録', `/projects/${projectId}/minutes`)}
      {gate.toolsRequired && row(gate.tools, '道具の確認', `/projects/${projectId}/tools`)}
      <p className="text-xs text-amber-800">燃料代・車両代・経費は、このまま入力できます。</p>

      {!showUnlock ? (
        <button type="button" onClick={() => setShowUnlock(true)} className="text-xs text-gray-500 underline self-start py-1">
          社長の合言葉でこの日だけ解除する
        </button>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-2">
          <label htmlFor="gate-passcode" className="text-xs text-gray-600">
            雨で KY写真が撮れなかった日などに使います。解除したことは操作の記録と夕方の報告に残ります。
          </label>
          <input id="gate-passcode" type="password" autoComplete="off"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
            value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="社長の合言葉" />
          {msg && <p className="text-sm text-red-700">{msg}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setShowUnlock(false); setMsg('') }}
              className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">やめる</button>
            <button type="button" onClick={unlock} disabled={busy || !passcode.trim()}
              className="flex-1 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-40">
              {busy ? '確認中...' : '解除する'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
