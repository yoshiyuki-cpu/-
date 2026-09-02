'use client'
import { useEffect, useState } from 'react'
import { supabase, FailureNote } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { hashPasscode, workerScope, ADMIN_SCOPE, ADMIN_PASSCODE_KEY } from '@/lib/passcode'

type Worker = { id: number; name: string; note_passcode_hash?: string | null }
type Mode = { kind: 'worker'; worker: Worker } | { kind: 'admin' }

const thisMonth = () => jstToday().slice(0, 7)

function monthLabel(m: string) {
  const [y, mm] = m.split('-')
  return `${y}年${Number(mm)}月`
}

function shiftMonth(m: string, diff: number) {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 1 + diff, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ReflectionPage() {
  const [foremen, setForemen] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [adminHash, setAdminHash] = useState<string | null>(null)

  // 入口
  const [pickedId, setPickedId] = useState('')
  const [passcode, setPasscode] = useState('')
  const [newPasscode, setNewPasscode] = useState('')
  const [gateError, setGateError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  // 開いた後
  const [mode, setMode] = useState<Mode | null>(null)
  const [month, setMonth] = useState(thisMonth())
  const [notes, setNotes] = useState<FailureNote[]>([])
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)

  useEffect(() => { loadMaster() }, [])
  useEffect(() => { if (mode) loadNotes() }, [mode, month])

  async function loadMaster() {
    setLoading(true)
    const [{ data: wk, error: wkErr }, { data: st }] = await Promise.all([
      supabase.from('workers').select('id, name, note_passcode_hash').eq('is_foreman', true).order('name'),
      supabase.from('app_settings').select('key, value').eq('key', ADMIN_PASSCODE_KEY),
    ])
    // 列やテーブルがまだ無い環境では、壊れた見た目ではなく次にやる事を出す
    if (wkErr) setNeedsSetup(true)
    setForemen(wk ?? [])
    setAdminHash((st ?? [])[0]?.value ?? null)
    setLoading(false)
  }

  async function loadNotes() {
    if (!mode) return
    let q = supabase.from('failure_notes').select('*').eq('month', month)
    if (mode.kind === 'worker') q = q.eq('worker_id', mode.worker.id)
    const { data } = await q.order('created_at', { ascending: false })
    setNotes(data ?? [])
  }

  // --- 入口の処理 ---
  async function enterAsWorker() {
    const w = foremen.find(f => String(f.id) === pickedId)
    if (!w) return
    setChecking(true)
    setGateError(null)
    if (!w.note_passcode_hash) {
      // 初回。その職長が自分で合言葉を決める
      if (newPasscode.length < 4) { setGateError('合言葉は4文字以上にしてください。'); setChecking(false); return }
      const hash = await hashPasscode(workerScope(w.id), newPasscode)
      const { error } = await supabase.from('workers').update({ note_passcode_hash: hash }).eq('id', w.id)
      if (error) {
        setGateError(error.message.includes('note_passcode_hash')
          ? '振り返りの準備がまだです。Supabaseで supabase-schema-failure-notes.sql を実行してください。'
          : '合言葉を保存できませんでした。')
        setChecking(false); return
      }
      setMode({ kind: 'worker', worker: { ...w, note_passcode_hash: hash } })
    } else {
      const hash = await hashPasscode(workerScope(w.id), passcode)
      if (hash !== w.note_passcode_hash) { setGateError('合言葉が違います。'); setChecking(false); return }
      setMode({ kind: 'worker', worker: w })
    }
    setPasscode(''); setNewPasscode(''); setChecking(false)
  }

  async function enterAsAdmin() {
    setChecking(true)
    setGateError(null)
    if (!adminHash) {
      if (newPasscode.length < 4) { setGateError('合言葉は4文字以上にしてください。'); setChecking(false); return }
      const hash = await hashPasscode(ADMIN_SCOPE, newPasscode)
      const { error } = await supabase.from('app_settings')
        .upsert({ key: ADMIN_PASSCODE_KEY, value: hash, updated_at: new Date().toISOString() })
      if (error) {
        setGateError('振り返りの準備がまだです。Supabaseで supabase-schema-failure-notes.sql を実行してください。')
        setChecking(false); return
      }
      setAdminHash(hash)
      setMode({ kind: 'admin' })
    } else {
      const hash = await hashPasscode(ADMIN_SCOPE, passcode)
      if (hash !== adminHash) { setGateError('合言葉が違います。'); setChecking(false); return }
      setMode({ kind: 'admin' })
    }
    setPasscode(''); setNewPasscode(''); setChecking(false)
  }

  // --- 記入 ---
  async function save() {
    if (mode?.kind !== 'worker' || !body.trim()) return
    setSaving(true)
    const { error } = await supabase.from('failure_notes').insert({
      worker_id: mode.worker.id, month, body: body.trim(),
    })
    setSaving(false)
    if (error) { alert('保存できませんでした。'); return }
    setBody('')
    await loadNotes()
  }

  async function saveEdit() {
    if (!editing || !editing.body.trim()) return
    const { error } = await supabase.from('failure_notes')
      .update({ body: editing.body.trim(), updated_at: new Date().toISOString() }).eq('id', editing.id)
    if (error) { alert('保存できませんでした。'); return }
    setEditing(null)
    await loadNotes()
  }

  async function remove(n: FailureNote) {
    if (!confirm('この記録を削除しますか？元に戻せません。')) return
    await supabase.from('failure_notes').delete().eq('id', n.id)
    await loadNotes()
  }

  const nameOf = (id: number | null) => foremen.find(f => f.id === id)?.name ?? '（不明）'
  const picked = foremen.find(f => String(f.id) === pickedId)

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  // ===== 入口 =====
  if (!mode) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-1">振り返り</h1>
        <p className="text-xs text-gray-500 mb-4">
          今月うまくいかなかった事を書き残す場所です。書いた本人と管理者だけが開けます。
        </p>

        {needsSetup && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
            <p className="text-sm text-amber-800">振り返りの準備がまだです。</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Supabaseで <span className="font-mono">supabase-schema-failure-notes.sql</span> を実行すると使えるようになります。
            </p>
          </div>
        )}

        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="font-bold text-gray-700 mb-3">職長の方</h2>
          <select className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
            value={pickedId} onChange={e => { setPickedId(e.target.value); setGateError(null) }}>
            <option value="">名前を選んでください</option>
            {foremen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          {picked && !picked.note_passcode_hash && (
            <>
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                初めてです。自分の合言葉を決めてください。次回からこの合言葉で開きます。
              </p>
              <input type="password" autoComplete="off" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
                value={newPasscode} onChange={e => setNewPasscode(e.target.value)} placeholder="決める合言葉（4文字以上）" />
            </>
          )}
          {picked && picked.note_passcode_hash && (
            <input type="password" autoComplete="off" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
              value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="合言葉" />
          )}

          <button onClick={enterAsWorker} disabled={!picked || checking}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-40">
            {checking ? '確認中...' : picked && !picked.note_passcode_hash ? '合言葉を決めて開く' : '開く'}
          </button>
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="font-bold text-gray-700 mb-3">管理者</h2>
          {!adminHash && (
            <>
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                管理者の合言葉がまだ決まっていません。ここで決めてください。忘れると全員分が見られなくなります。
              </p>
              <input type="password" autoComplete="off" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
                value={newPasscode} onChange={e => setNewPasscode(e.target.value)} placeholder="決める合言葉（4文字以上）" />
            </>
          )}
          {adminHash && (
            <input type="password" autoComplete="off" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
              value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="管理者の合言葉" />
          )}
          <button onClick={enterAsAdmin} disabled={checking}
            className="w-full border border-blue-600 text-blue-600 py-3 rounded-xl font-medium disabled:opacity-40">
            {adminHash ? '全員分を見る' : '合言葉を決める'}
          </button>
        </section>

        {gateError && <p className="text-sm text-red-600 mb-3">{gateError}</p>}

        <p className="text-[11px] text-gray-400 leading-relaxed">
          この合言葉はアプリの画面を隠すためのものです。書いた内容そのものは暗号化していないので、
          データベースを直接見られる相手には読めます。人に知られたら困る事は書かないでください。
        </p>
      </div>
    )
  }

  // ===== 開いた後 =====
  return (
    <div>
      <div className="flex justify-between items-start mb-1">
        <h1 className="text-xl font-bold">振り返り</h1>
        <button onClick={() => { setMode(null); setNotes([]); setPickedId('') }}
          className="text-xs text-gray-500 border border-gray-200 rounded-full px-3 py-1.5">閉じる</button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {mode.kind === 'admin' ? '管理者として全員分を見ています。' : `${mode.worker.name}さんの記録です。他の職長には見えません。`}
      </p>

      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-4">
        <button onClick={() => setMonth(shiftMonth(month, -1))}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前月</button>
        <span className="font-bold text-gray-700 text-sm">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30">翌月 →</button>
      </div>

      {mode.kind === 'worker' && month === thisMonth() && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <label className="block text-sm font-medium mb-1">うまくいかなかった事</label>
          <textarea className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base resize-none" rows={4}
            value={body} onChange={e => setBody(e.target.value)}
            placeholder="例：段取りの連絡が遅れて、朝に人が足りなかった" />
          <button onClick={save} disabled={saving || !body.trim()}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-40 mt-2">
            {saving ? '保存中...' : '記録する'}
          </button>
        </section>
      )}

      {notes.length === 0 && (
        <p className="text-gray-400 text-center py-10 text-sm">{monthLabel(month)}の記録はありません。</p>
      )}

      <div className="flex flex-col gap-2">
        {notes.map(n => (
          <div key={n.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {mode.kind === 'admin' && (
              <p className="text-xs font-semibold text-blue-700 mb-1">{nameOf(n.worker_id)}</p>
            )}
            {editing?.id === n.id ? (
              <>
                <textarea className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" rows={4}
                  value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setEditing(null)}
                    className="flex-1 py-1.5 border border-gray-200 rounded-xl text-sm text-gray-600">キャンセル</button>
                  <button onClick={saveEdit}
                    className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-sm">保存</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.body}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[11px] text-gray-400">{n.created_at.slice(0, 10)}</span>
                  {mode.kind === 'worker' && (
                    <>
                      <button onClick={() => setEditing({ id: n.id, body: n.body })}
                        className="text-xs text-blue-600 ml-auto">編集</button>
                      <button onClick={() => remove(n)} className="text-xs text-gray-300 hover:text-red-400">削除</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
