'use client'
import { useSyncExternalStore } from 'react'

// この端末を使っている人。ログインの第1段階。
//
// 本格的な認証（Supabase Auth と権限）はまだ入れていない。まず「誰が操作したか」を
// 残せるようにするために、端末ごとに名前を選んでもらう。合言葉は無いので
// なりすましは防げない。防ぐのは次の段階で、その時もこの選択の形はそのまま使う。
export type DeviceUser = { id: number; name: string }

const KEY = 'ryoshin_user'
const EVENT = 'ryoshin-user-change'

export function readUser(): DeviceUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    return typeof u?.id === 'number' && typeof u?.name === 'string' ? u : null
  } catch {
    return null
  }
}

export function setUser(u: DeviceUser | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u))
    else localStorage.removeItem(KEY)
  } catch { /* 保存できない端末では今回だけ効く */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

// useSyncExternalStore は毎回同じ参照を返す必要があるので、文字列で持って比較する
let cachedRaw: string | null = null
let cachedUser: DeviceUser | null = null
function getSnapshot(): DeviceUser | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { raw = null }
  if (raw !== cachedRaw) { cachedRaw = raw; cachedUser = readUser() }
  return cachedUser
}

export function useDeviceUser(): DeviceUser | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
