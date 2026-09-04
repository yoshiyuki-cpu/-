'use client'
import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

// 圏外での入力を端末に貯めておき、つながったら送る。
//
// 解体現場は地下や山あいで回線が切れる。切れている間に押した「保存する」を
// 失敗にせず端末に置き、つながった時に自動で送る。写真は大きいので対象外
// （文字の記録だけ：人工・廃材・燃料代・車両代・経費）。
//
// 送れなかった理由が「回線」なら次につながった時に再送、「DBに断られた」なら
// 再送しても無駄なので印を付けて画面に出し、本人が消せるようにする。
export type QueuedInsert = {
  id: string
  table: string
  rows: Record<string, unknown>[]
  label: string          // 画面に出す説明（例：「福田 人工 3名」）
  createdAt: string
  error?: string         // DBに断られたときの理由
}

const KEY = 'ryoshin_offline_queue'
const EVENT = 'ryoshin-offline-change'

function read(): QueuedInsert[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function write(list: QueuedInsert[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* 保存できない端末では諦める */ }
  window.dispatchEvent(new Event(EVENT))
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// supabase-js は回線が無いとき error.message に fetch の失敗が入る。DBの断りと区別する
export function isNetworkError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false
  if (error.code) return false   // PostgREST のエラーコードがあればDB側の断り
  const m = (error.message ?? '').toLowerCase()
  return m.includes('fetch') || m.includes('network') || m.includes('load failed') || m.includes('timeout')
}

export function enqueue(table: string, rows: Record<string, unknown>[], label: string) {
  const item: QueuedInsert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    table, rows, label, createdAt: new Date().toISOString(),
  }
  write([...read(), item])
  return item
}

export function listQueue() { return read() }

export function removeQueued(id: string) {
  write(read().filter(q => q.id !== id))
}

let flushing = false

// 貯めた分を順に送る。回線の失敗はそこで止めて次回に回す
export async function flushQueue(supabase: SupabaseClient): Promise<{ sent: number; kept: number }> {
  if (flushing) return { sent: 0, kept: read().length }
  flushing = true
  let sent = 0
  try {
    for (const item of read()) {
      if (item.error) continue   // 断られた分は本人が判断する
      const { error } = await supabase.from(item.table).insert(item.rows)
      if (!error) { removeQueued(item.id); sent++; continue }
      if (isNetworkError(error)) break
      // DBに断られた。理由を付けて残す
      write(read().map(q => q.id === item.id ? { ...q, error: error.message } : q))
    }
  } finally {
    flushing = false
  }
  return { sent, kept: read().length }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb) }
}
let cachedRaw: string | null = null
let cachedList: QueuedInsert[] = []
function snapshot() {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { raw = null }
  if (raw !== cachedRaw) { cachedRaw = raw; cachedList = read() }
  return cachedList
}
const EMPTY: QueuedInsert[] = []
export function useOfflineQueue(): QueuedInsert[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}
