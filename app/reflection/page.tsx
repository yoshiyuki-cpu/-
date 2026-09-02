'use client'
import { useEffect, useState } from 'react'
import { supabase, FailureNote } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { hashPasscode, workerScope, ADMIN_SCOPE, ADMIN_PASSCODE_KEY, REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'

type Worker = { id: number; name: string; note_passcode_hash?: string | null }
type Mode = { kind: 'worker'; worker: Worker } | { kind: 'admin' }
// 入口で最初に選ぶ役割。null = まだ選んでいない
type Role = null | 'worker' | 'admin'

// 一度開いた端末では次から合言葉を聞かない。合言葉そのものは持たずハッシュを控え、
// 開くときにDBの値と一致するか見る（社長がリセットしたら自動的に効かなくなる）
const REMEMBER_KEY = 'reflection_unlock'

function remember(v: unknown) {
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(v)) } catch { /* 使えない端末は毎回入力 */ }
}
function recall(): { kind: 'worker'; workerId: number; hash: string } | { kind: 'admin'; hash: string } | null {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null') } catch { return null }
}
function forget() {
  try { localStorage.removeItem(REMEMBER_KEY) } catch { /* 何もしない */ }
}

const thisMonth = () => jstToday().slice(0, 7)

function monthLabel(m: string) {
  const [y, mm] = m.split('-')
  return `${y}年${Number(mm)}月`
}

function dateLabel(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, day).getDay()]
  return `${m}/${day}（${w}）`
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

  const [role, setRole] = useState<Role>(null)
  const [pickedId, setPickedId] = useState('')
  const [passcode, setPasscode] = useState('')
  const [gateError, setGateError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const [mode, setMode] = useState<Mode | null>(null)
  const [month, setMonth] = useState(thisMonth())
  const [notes, setNotes] = useState<FailureNote[]>([])
  // その日の「良かったこと」「悪かったこと」を両方まとめて書けるようにする
  const [entryDate, setEntryDate] = useState(jstToday())
  const [goodBody, setGoodBody] = useState('')
  const [badBody, setBadBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notifySaved, setNotifySaved] = useState(false)

  useEffect(() => { loadMaster() }, [])
  useEffect(() => { if (mode) loadNotes() }, [mode, month])

  async function loadMaster() {
    setLoading(true)
    const [{ data: wk, error: wkErr }, { data: st }] = await Promise.all([
      supabase.from('workers').select('id, name, note_passcode_hash').eq('is_foreman', true).order('name'),
      // 設定はまとめて取り、JS側で振り分ける
      supabase.from('app_settings').select('key, value'),
    ])
    // 列やテーブルがまだ無い環境では、壊れた見た目ではなく次にやる事を出す
    if (wkErr) setNeedsSetup(true)
    const list = wk ?? []
    const settings = (st ?? []) as { key: string; value: string | null }[]
    const admin = settings.find(s => s.key === ADMIN_PASSCODE_KEY)?.value ?? null
    setNotifyEmail(settings.find(s => s.key === REFLECTION_NOTIFY_EMAIL_KEY)?.value ?? '')
    setForemen(list)
    setAdminHash(admin)

    // この端末で一度開いていれば、そのまま開く
    const saved = recall()
    if (saved?.kind === 'admin' && admin && saved.hash === admin) setMode({ kind: 'admin' })
    if (saved?.kind === 'worker') {
      const w = list.find(f => f.id === saved.workerId)
      if (w && w.note_passcode_hash && w.note_passcode_hash === saved.hash) setMode({ kind: 'worker', worker: w })
    }
    setLoading(false)
  }

  async function loadNotes() {
    if (!mode) return
    // kind と date は追加したばかりの列なので、DB側で絞ったり並べたりしない。
    // SQL未実行の環境ではクエリごと失敗して一覧が空になるため
    let q = supabase.from('failure_notes').select('*').eq('month', month)
    if (mode.kind === 'worker') q = q.eq('worker_id', mode.worker.id)
    const { data } = await q.order('created_at', { ascending: false })
    setNotes(data ?? [])
  }

  // 日付ごとにまとめる。日付が入っていない古い記録は月初として扱う
  const dayOf = (n: FailureNote) => n.date || `${n.month}-01`
  const byDate = notes.reduce<Record<string, FailureNote[]>>((acc, n) => {
    const d = dayOf(n)
    acc[d] = [...(acc[d] ?? []), n]
    return acc
  }, {})
  const dates = Object.keys(byDate).sort().reverse()

  // --- 入口 ---
  async function enterAsWorker() {
    const w = foremen.find(f => String(f.id) === pickedId)
    if (!w) return
    setChecking(true)
    setGateError(null)
    if (!w.note_passcode_hash) {
      if (passcode.length < 4) { setGateError('合言葉は4文字以上にしてください。'); setChecking(false); return }
      const hash = await hashPasscode(workerScope(w.id), passcode)
      const { error } = await supabase.from('workers').update({ note_passcode_hash: hash }).eq('id', w.id)
      if (error) {
        setGateError(error.message.includes('note_passcode_hash')
          ? '振り返りの準備がまだです。Supabaseで supabase-schema-failure-notes.sql を実行してください。'
          : '合言葉を保存できませんでした。')
        setChecking(false); return
      }
      remember({ kind: 'worker', workerId: w.id, hash })
      setMode({ kind: 'worker', worker: { ...w, note_passcode_hash: hash } })
    } else {
      const hash = await hashPasscode(workerScope(w.id), passcode)
      if (hash !== w.note_passcode_hash) { setGateError('合言葉が違います。'); setChecking(false); return }
      remember({ kind: 'worker', workerId: w.id, hash })
      setMode({ kind: 'worker', worker: w })
    }
    setPasscode(''); setChecking(false)
  }

  async function enterAsAdmin() {
    setChecking(true)
    setGateError(null)
    if (!adminHash) {
      if (passcode.length < 4) { setGateError('合言葉は4文字以上にしてください。'); setChecking(false); return }
      const hash = await hashPasscode(ADMIN_SCOPE, passcode)
      const { error } = await supabase.from('app_settings')
        .upsert({ key: ADMIN_PASSCODE_KEY, value: hash, updated_at: new Date().toISOString() })
      if (error) {
        setGateError('振り返りの準備がまだです。Supabaseで supabase-schema-failure-notes.sql を実行してください。')
        setChecking(false); return
      }
      setAdminHash(hash)
      remember({ kind: 'admin', hash })
      setMode({ kind: 'admin' })
    } else {
      const hash = await hashPasscode(ADMIN_SCOPE, passcode)
      if (hash !== adminHash) { setGateError('合言葉が違います。'); setChecking(false); return }
      remember({ kind: 'admin', hash })
      setMode({ kind: 'admin' })
    }
    setPasscode(''); setChecking(false)
  }

  function close() {
    forget()
    setMode(null); setNotes([]); setRole(null); setPickedId(''); setPasscode(''); setGateError(null)
  }

  // --- 記入 ---
  async function save() {
    if (mode?.kind !== 'worker') return
    const good = goodBody.trim()
    const bad = badBody.trim()
    if (!good && !bad) return
    setSaving(true)

    const rows = [
      ...(good ? [{ kind: 'good', body: good }] : []),
      ...(bad ? [{ kind: 'bad', body: bad }] : []),
    ].map(r => ({
      worker_id: mode.worker.id,
      // 月は日付から作る。カレンダーの月移動と食い違わないようにするため
      month: entryDate.slice(0, 7),
      date: entryDate,
      kind: r.kind,
      body: r.body,
    }))

    const { error } = await supabase.from('failure_notes').insert(rows)
    if (error) {
      setSaving(false)
      alert(error.message.includes('kind') || error.message.includes('date')
        ? '良い・悪いの記録の準備がまだです。Supabaseで supabase-schema-reflection-good-bad.sql を実行してください。'
        : '保存できませんでした。')
      return
    }

    // 社長への通知。届かなくても記入は成功しているので、失敗させない
    for (const r of rows) {
      try {
        await fetch('/api/reflection-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workerName: mode.worker.name, kind: r.kind, date: entryDate }),
        })
      } catch { /* 通知が飛ばなくても記入は残る */ }
    }

    setSaving(false)
    setGoodBody(''); setBadBody('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    // 書いた日の月を見ていない場合は、その月に移して確認できるようにする
    if (entryDate.slice(0, 7) !== month) setMonth(entryDate.slice(0, 7))
    else await loadNotes()
  }

  async function saveNotifyEmail() {
    const { error } = await supabase.from('app_settings')
      .upsert({ key: REFLECTION_NOTIFY_EMAIL_KEY, value: notifyEmail.trim() || null, updated_at: new Date().toISOString() })
    if (error) { alert('通知先を保存できませんでした。'); return }
    setNotifySaved(true)
    setTimeout(() => setNotifySaved(false), 2500)
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

  // 合言葉を忘れた職長のために、社長が消して決め直させる
  async function resetWorkerPasscode(w: Worker) {
    if (!confirm(`${w.name}さんの合言葉を消しますか？\n次に開くとき、本人が新しい合言葉を決め直します。書いた記録は消えません。`)) return
    setResetting(true)
    const { error } = await supabase.from('workers').update({ note_passcode_hash: null }).eq('id', w.id)
    setResetting(false)
    if (error) { alert('リセットできませんでした。'); return }
    setForemen(fs => fs.map(f => f.id === w.id ? { ...f, note_passcode_hash: null } : f))
  }

  const nameOf = (id: number | null) => foremen.find(f => f.id === id)?.name ?? '（不明）'
  const picked = foremen.find(f => String(f.id) === pickedId)
  const isFirstTime = role === 'worker' ? (picked ? !picked.note_passcode_hash : false) : !adminHash

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  // ===== 入口 =====
  if (!mode) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-1">振り返り</h1>
        <p className="text-xs text-gray-500 mb-4">
          今月うまくいかなかった事を書き残す場所です。書いた本人と社長だけが開けます。
        </p>

        {needsSetup && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
            <p className="text-sm text-amber-800">振り返りの準備がまだです。</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Supabaseで <span className="font-mono">supabase-schema-failure-notes.sql</span> を実行すると使えるようになります。
            </p>
          </div>
        )}

        {/* まずどちらか選ぶ。合言葉の欄を2つ同時に出さない */}
        {role === null && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-medium mb-3">どちらですか？</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => { setRole('worker'); setGateError(null) }}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium">
                職長（自分の失敗を書く）
              </button>
              <button onClick={() => { setRole('admin'); setGateError(null) }}
                className="w-full border border-blue-600 text-blue-600 py-3 rounded-xl font-medium">
                社長（全員分を読む）
              </button>
            </div>
          </section>
        )}

        {role !== null && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-bold text-gray-700">{role === 'worker' ? '職長' : '社長'}</h2>
              <button onClick={() => { setRole(null); setPickedId(''); setPasscode(''); setGateError(null) }}
                className="text-xs text-gray-500">選び直す</button>
            </div>

            {role === 'worker' && (
              <select className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
                value={pickedId} onChange={e => { setPickedId(e.target.value); setPasscode(''); setGateError(null) }}>
                <option value="">名前を選んでください</option>
                {foremen.map(f => (
                  <option key={f.id} value={f.id}>{f.name}{f.note_passcode_hash ? '' : '（はじめて）'}</option>
                ))}
              </select>
            )}

            {(role === 'admin' || picked) && (
              <>
                {isFirstTime && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                    はじめてなので、合言葉を決めてください。<span className="font-bold">決めるのはこの1回だけです。</span>
                    {role === 'admin' && '忘れると全員分が読めなくなります。'}
                  </p>
                )}
                <input type="password" autoComplete="off"
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
                  value={passcode} onChange={e => setPasscode(e.target.value)}
                  placeholder={isFirstTime ? '決める合言葉（4文字以上）' : '合言葉'} />
                <button onClick={role === 'worker' ? enterAsWorker : enterAsAdmin} disabled={checking || !passcode}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-40">
                  {checking ? '確認中...' : isFirstTime ? '合言葉を決めて開く' : '開く'}
                </button>
                <p className="text-[11px] text-gray-400 mt-2">
                  この端末では、次からこの画面を出しません（毎回打つ必要はありません）。
                </p>
              </>
            )}

            {gateError && <p className="text-sm text-red-600 mt-3">{gateError}</p>}
          </section>
        )}

        <p className="text-[11px] text-gray-400 leading-relaxed mt-4">
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
        <button onClick={close}
          className="text-xs text-gray-500 border border-gray-200 rounded-full px-3 py-1.5">閉じる</button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {mode.kind === 'admin' ? '社長として全員分を見ています。' : `${mode.worker.name}さんの記録です。他の職長には見えません。`}
        <br />
        <span className="text-gray-400">「閉じる」を押すと、次からまた合言葉を聞きます。</span>
      </p>

      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-4">
        <button onClick={() => setMonth(shiftMonth(month, -1))}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前月</button>
        <span className="font-bold text-gray-700 text-sm">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30">翌月 →</button>
      </div>

      {mode.kind === 'worker' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          {saved && (
            <div className="bg-green-100 text-green-700 rounded-lg px-3 py-2 text-sm mb-3">
              記録しました ✓　社長に知らせました
            </div>
          )}
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">どの日のこと</label>
            <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base"
              value={entryDate} max={jstToday()} onChange={e => setEntryDate(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">前の日の分も書けます</p>
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1 text-blue-700">良かったこと</label>
            <textarea className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base resize-none" rows={3}
              value={goodBody} onChange={e => setGoodBody(e.target.value)}
              placeholder="例：新人に先に段取りを説明したら、朝の動きが早くなった" />
          </div>
          <div className="mb-1">
            <label className="block text-sm font-medium mb-1 text-red-700">悪かったこと</label>
            <textarea className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base resize-none" rows={3}
              value={badBody} onChange={e => setBadBody(e.target.value)}
              placeholder="例：段取りの連絡が遅れて、朝に人が足りなかった" />
          </div>
          <p className="text-xs text-gray-400 mb-2">片方だけでも記録できます</p>
          <button onClick={save} disabled={saving || (!goodBody.trim() && !badBody.trim())}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-40">
            {saving ? '保存中...' : '記録する'}
          </button>
        </section>
      )}

      {notes.length === 0 && (
        <p className="text-gray-400 text-center py-10 text-sm">{monthLabel(month)}の記録はありません。</p>
      )}

      {/* 日付ごとにまとめて、その日その日を振り返れるようにする */}
      <div className="flex flex-col gap-4">
        {dates.map(d => (
          <div key={d}>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">{dateLabel(d)}</p>
            <div className="flex flex-col gap-2">
              {[...byDate[d]].sort((a, b) => (a.kind === 'good' ? -1 : 1) - (b.kind === 'good' ? -1 : 1)).map(n => {
                const isGood = n.kind === 'good'
                return (
                  <div key={n.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${isGood ? 'border-blue-100' : 'border-red-100'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${isGood ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                        {isGood ? '良かったこと' : '悪かったこと'}
                      </span>
                      {mode.kind === 'admin' && (
                        <span className="text-xs font-semibold text-gray-600">{nameOf(n.worker_id)}</span>
                      )}
                    </div>
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
                        {mode.kind === 'worker' && (
                          <div className="flex items-center gap-3 mt-2">
                            <button onClick={() => setEditing({ id: n.id, body: n.body })}
                              className="text-xs text-blue-600 ml-auto">編集</button>
                            <button onClick={() => remove(n)} className="text-xs text-gray-300 hover:text-red-400">削除</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 記入があったときの通知先 */}
      {mode.kind === 'admin' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-4">
          <h2 className="font-bold text-gray-700 text-sm mb-1">記入があったときの通知先</h2>
          <p className="text-xs text-gray-500 mb-2">
            職長が記入するとこのメールアドレスに届きます。誰がいつ書いたかだけを送り、
            中身は載せません（メールのプレビューに出ないようにするため）。空欄にすると通知しません。
          </p>
          {notifySaved && (
            <div className="bg-green-100 text-green-700 rounded-lg px-3 py-2 text-sm mb-2">保存しました ✓</div>
          )}
          <input type="email" inputMode="email" autoComplete="off"
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mb-2"
            value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)}
            placeholder="社長のメールアドレス" />
          <button onClick={saveNotifyEmail}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-medium text-sm">
            通知先を保存
          </button>
        </section>
      )}

      {/* 合言葉を忘れた職長の面倒を社長が見られるようにする */}
      {mode.kind === 'admin' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-4">
          <h2 className="font-bold text-gray-700 text-sm mb-1">職長の合言葉</h2>
          <p className="text-xs text-gray-500 mb-3">
            忘れた人がいたら消してください。次に開くとき本人が決め直します。書いた記録は消えません。
          </p>
          <div className="flex flex-col gap-1">
            {foremen.map(f => (
              <div key={f.id} className="flex justify-between items-center text-sm py-2 border-b last:border-0">
                <span>{f.name}</span>
                {f.note_passcode_hash ? (
                  <button onClick={() => resetWorkerPasscode(f)} disabled={resetting}
                    className="text-xs text-blue-600 border border-gray-200 rounded-full px-3 py-1 disabled:opacity-40">
                    合言葉を消す
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">未設定</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
