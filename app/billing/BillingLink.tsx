'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useDeviceUser, OWNER_USER } from '@/lib/user'
import { fetchMembers } from '@/lib/billing'

// 「その他」の入口。権限のある人の端末にだけ出す（ほかの人に売上の画面があることを見せない）
export default function BillingLink() {
  const user = useDeviceUser()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let active = true
    const signedIn = (() => { try { return localStorage.getItem('ryoshin_billing_member') !== null } catch { return false } })()
    if (user?.id === OWNER_USER.id || signedIn) {
      Promise.resolve().then(() => { if (active) setAllowed(true) })
      return () => { active = false }
    }
    if (!user) {
      Promise.resolve().then(() => { if (active) setAllowed(false) })
      return () => { active = false }
    }
    fetchMembers()
      .then(list => { if (active) setAllowed(list.some(m => m.active && m.worker_id === user.id)) })
      .catch(() => { if (active) setAllowed(false) })
    return () => { active = false }
  }, [user])

  if (!allowed) return null
  return (
    <Link href="/billing" className="shrink-0 whitespace-nowrap text-sm text-blue-600 border border-gray-200 bg-white rounded-full px-3 py-1.5">💴 売上・請求書</Link>
  )
}
