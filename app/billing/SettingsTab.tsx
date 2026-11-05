'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { hashPasscode } from '@/lib/passcode'
import { BillingMember, BillingRole, fetchMembers, fetchSettings, saveMember, saveSettings } from '@/lib/billing'
import { BillingMe, isOwner, memberScope } from '@/lib/billingSession'

const INPUT = 'mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'
const ROLES: { key: BillingRole; label: string; help: string }[] = [
  { key: 'view', label: '見るだけ', help: '売上と請求書を見る、PDFを保存する' },
  { key: 'edit', label: '記入まで', help: '上に加えて、売上と元請を入れる、下書きを直す' },
  { key: 'confirm', label: '確定まで', help: '上に加えて、請求書を確定・解除する、発行者の情報を直す' },
]

type Issuer = {
  issuer_name: string; postal_code: string; address: string; office_name: string; tel: string
  invoice_registration_no: string; bank_name: string; bank_branch: string; account_type: string; account_number: string
  stamp_data: string
}
const FIELDS: { key: keyof Issuer; label: string; placeholder?: string }[] = [
  { key: 'issuer_name', label: '会社名' },
  { key: 'postal_code', label: '郵便番号' },
  { key: 'address', label: '住所' },
  { key: 'office_name', label: '事務所名' },
  { key: 'tel', label: 'TEL' },
  { key: 'invoice_registration_no', label: 'インボイス番号', placeholder: 'T0000000000000' },
  { key: 'bank_name', label: '振込先の金融機関' },
  { key: 'bank_branch', label: '支店' },
  { key: 'account_type', label: '口座の種類（普・当）' },
  { key: 'account_number', label: '口座番号' },
]

// 角印を画面で読み込み、大きすぎないように縮めて文字列で持つ
function readStamp(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 400 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした。')) }
    img.src = url
  })
}

export default function SettingsTab({ me, onMembersChanged }: { me: BillingMe; onMembersChanged: () => void }) {
  const [issuer, setIssuer] = useState<Issuer | null>(null)
  const [members, setMembers] = useState<BillingMember[]>([])
  const [workers, setWorkers] = useState<{ id: number; name: string; email: string | null }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [workerId, setWorkerId] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<BillingRole>('view')

  async function load() {
    try {
      const [s, m, w, co] = await Promise.all([
        fetchSettings(), fetchMembers(),
        supabase.from('workers').select('id, name, email').order('name'),
        supabase.from('company_settings').select('*').limit(1),
      ])
      // 初回だけ、見積の会社情報を入れておく。見本と違うところは直してから保存してもらう
      const c = (co.data?.[0] ?? {}) as Record<string, string | null>
      setIssuer({
        issuer_name: s?.issuer_name ?? c.name ?? '', postal_code: s?.postal_code ?? c.postal_code ?? '', address: s?.address ?? c.address ?? '',
        office_name: s?.office_name ?? c.office_name ?? '', tel: s?.tel ?? c.tel ?? '',
        invoice_registration_no: s?.invoice_registration_no ?? '', bank_name: s?.bank_name ?? '', bank_branch: s?.bank_branch ?? '',
        account_type: s?.account_type ?? '普', account_number: s?.account_number ?? '', stamp_data: s?.stamp_data ?? '',
      })
      setMembers(m)
      setWorkers((w.data ?? []) as { id: number; name: string; email: string | null }[])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込めませんでした。')
    }
  }
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false }
  }, [])

  async function saveIssuer() {
    if (!issuer || busy) return
    setBusy(true); setMessage('')
    try {
      await saveSettings({ ...issuer, stamp_data: issuer.stamp_data || null })
      setMessage('請求書の設定を保存しました。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
    setBusy(false)
  }

  async function pickStamp(file: File | undefined) {
    if (!file || !issuer) return
    try { setIssuer({ ...issuer, stamp_data: await readStamp(file) }) }
    catch (err) { setMessage(err instanceof Error ? err.message : '画像を読み込めませんでした。') }
  }

  async function changed(fn: () => Promise<void>, done: string) {
    setMessage('')
    try {
      await fn()
      await load()
      onMembersChanged()
      setMessage(done)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした。')
    }
  }

  function addMember() {
    const w = workers.find(x => String(x.id) === workerId)
    const name = (w?.name ?? newName).trim()
    if (!name) { setMessage('人を選ぶか、名前を入れてください。'); return }
    if (members.some(m => m.name === name)) { setMessage('この名前はもう登録されています。'); return }
    changed(async () => {
      await saveMember(null, { name, worker_id: w?.id ?? null, role: newRole, email: w?.email ?? null })
      setWorkerId(''); setNewName(''); setNewRole('view')
    }, `${name} さんを追加しました。合言葉を決めると入れるようになります。`)
  }

  function setPasscode(m: BillingMember) {
    const passcode = prompt(`${m.name} さんの合言葉を入れてください（4文字以上）`)
    if (passcode === null) return
    if (passcode.trim().length < 4) { setMessage('合言葉は4文字以上にしてください。'); return }
    changed(async () => {
      await saveMember(m.id, { passcode_hash: await hashPasscode(memberScope(m.id), passcode.trim()) })
    }, `${m.name} さんの合言葉を決めました。本人にだけ伝えてください。`)
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <p className="text-sm text-blue-800 bg-blue-50 rounded-xl px-3 py-2">{message}</p>}

      {isOwner(me) && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
          <h2 className="font-bold text-sm text-gray-700">売上を扱える人</h2>
          <ul className="text-xs text-gray-500 flex flex-col gap-0.5">
            {ROLES.map(r => <li key={r.key}><b>{r.label}</b>：{r.help}</li>)}
          </ul>
          {members.length === 0 && <p className="text-sm text-gray-500">今は社長だけが入れます。</p>}
          {members.map(m => (
            <div key={m.id} className={`border border-gray-100 rounded-xl p-3 flex flex-col gap-2 ${m.active ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{m.name}{m.active ? '' : '（止めています）'}</p>
                <span className={`text-xs ${m.passcode_hash ? 'text-emerald-700' : 'text-amber-700'}`}>{m.passcode_hash ? '合言葉あり' : '合言葉なし'}</span>
              </div>
              <select value={m.role} aria-label={`${m.name} さんの権限`}
                onChange={e => changed(() => saveMember(m.id, { role: e.target.value as BillingRole }), `${m.name} さんの権限を変えました。`)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <label className="text-xs text-gray-500">下書きの通知先メール（確定までの人）
                <input defaultValue={m.email ?? ''} inputMode="email" onBlur={e => {
                  if (e.target.value.trim() !== (m.email ?? '')) changed(() => saveMember(m.id, { email: e.target.value.trim() || null }), '通知先を保存しました。')
                }} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setPasscode(m)} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">合言葉を決める</button>
                <button onClick={() => changed(() => saveMember(m.id, { active: !m.active }), m.active ? `${m.name} さんを止めました。` : `${m.name} さんを戻しました。`)}
                  className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">{m.active ? '止める' : '戻す'}</button>
              </div>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
            <p className="text-sm font-medium">人を追加する</p>
            <select value={workerId} onChange={e => setWorkerId(e.target.value)} aria-label="追加する人" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">作業員の一覧にいない人（下に名前を入れる）</option>
              {workers.filter(w => !members.some(m => m.worker_id === w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {!workerId && <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="名前" aria-label="名前" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />}
            <select value={newRole} onChange={e => setNewRole(e.target.value as BillingRole)} aria-label="追加する人の権限" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <button onClick={addMember} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium">追加する</button>
          </div>
        </section>
      )}

      {issuer && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
          <h2 className="font-bold text-sm text-gray-700">請求書に載せる自社の情報</h2>
          {FIELDS.map(f => (
            <label key={f.key} className="text-sm font-medium">{f.label}
              <input value={issuer[f.key]} placeholder={f.placeholder} onChange={e => setIssuer({ ...issuer, [f.key]: e.target.value })} className={INPUT} />
            </label>
          ))}
          <div className="text-sm font-medium">角印
            {issuer.stamp_data
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={issuer.stamp_data} alt="角印" className="w-24 h-24 object-contain border border-gray-100 rounded-lg mt-1" />
              : <p className="text-xs text-gray-500 font-normal mt-1">まだありません。背景が白か透明の画像を選んでください。</p>}
            <input type="file" accept="image/*" aria-label="角印の画像" onChange={e => pickStamp(e.target.files?.[0])} className="mt-2 block w-full text-xs font-normal" />
          </div>
          <button onClick={saveIssuer} disabled={busy} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">{busy ? '保存中...' : '保存'}</button>
        </section>
      )}
    </div>
  )
}
