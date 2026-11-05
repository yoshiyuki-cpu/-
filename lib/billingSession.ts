'use client'
// 売上の画面に入っている人。毎回合言葉を打たなくて済むよう端末に覚える。
// 【今の状態】これは画面の目隠しで、データそのものは守っていない（lib/billing.ts の先頭を参照）。
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ADMIN_PASSCODE_KEY, ADMIN_SCOPE, hashPasscode } from '@/lib/passcode'
import { BillingMember, BillingRole, fetchMembers, isNotReady, NOT_READY_MESSAGE } from '@/lib/billing'

export type BillingMe = { id: number; name: string; role: BillingRole | 'owner' }

const KEY = 'ryoshin_billing_member'
export const OWNER_MEMBER_ID = 0

export const memberScope = (id: number) => `billing-member-${id}`

export function canEdit(me: BillingMe) { return me.role !== 'view' }
export function canConfirm(me: BillingMe) { return me.role === 'confirm' || me.role === 'owner' }
export function isOwner(me: BillingMe) { return me.role === 'owner' }

function readId() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? null : Number(raw)
  } catch { return null }
}

function resolve(id: number | null, members: BillingMember[]): BillingMe | null {
  if (id === null) return null
  if (id === OWNER_MEMBER_ID) return { id, name: '社長', role: 'owner' }
  const m = members.find(x => x.id === id && x.active)
  // 権限を外された人は、端末に覚えていても入れない
  return m ? { id: m.id, name: m.name, role: m.role } : null
}

export function useBillingSession() {
  const [me, setMe] = useState<BillingMe | null>(null)
  const [members, setMembers] = useState<BillingMember[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    try {
      const list = await fetchMembers()
      setMembers(list)
      setMe(resolve(readId(), list))
      setMessage('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : NOT_READY_MESSAGE)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) reload() })
    return () => { active = false }
  }, [reload])

  async function login(id: number, passcode: string) {
    let saved: string | null | undefined
    let scope: string
    if (id === OWNER_MEMBER_ID) {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', ADMIN_PASSCODE_KEY).limit(1)
      if (error) throw new Error(isNotReady(error) ? NOT_READY_MESSAGE : 'もう一度お試しください。')
      saved = (data?.[0] as { value?: string } | undefined)?.value
      if (!saved) throw new Error('社長の合言葉がまだ決まっていません。その他 → 振り返り で決めてください。')
      scope = ADMIN_SCOPE
    } else {
      saved = members.find(m => m.id === id)?.passcode_hash
      if (!saved) throw new Error('合言葉がまだ決まっていません。社長に決めてもらってください。')
      scope = memberScope(id)
    }
    if (await hashPasscode(scope, passcode.trim()) !== saved) throw new Error('合言葉が違います。')
    try { localStorage.setItem(KEY, String(id)) } catch { /* 覚えられない端末は今回だけ入れる */ }
    setMe(resolve(id, members))
  }

  function logout() {
    try { localStorage.removeItem(KEY) } catch { /* 無視 */ }
    setMe(null)
  }

  return { me, members, loading, message, login, logout, reload }
}
