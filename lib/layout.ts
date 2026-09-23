'use client'
import { useSyncExternalStore } from 'react'

// 画面の組み立て（2026-09）。
//   today   … 新しい画面。ホームが「今日」、下の帯が 今日・現場・予定・その他 の4個
//   classic … 前の画面。ホームが現場の一覧、下の帯が 現場・段取り・出面・予定・マスタ
// 端末ごとに覚える。記録には一切触らないので、いつでも行き来できる。
export type Layout = 'today' | 'classic'

const KEY = 'ryoshin_layout'
const EVENT = 'ryoshin-layout-change'

function read(): Layout {
  try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'today' } catch { return 'today' }
}

export function setLayout(l: Layout) {
  try { localStorage.setItem(KEY, l) } catch { /* 保存できない端末では今回だけ効く */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb) }
}

// サーバーで描くときは決められないので null（画面側で「読み込み中」にする）
export function useLayout(): Layout | null {
  return useSyncExternalStore(subscribe, read, () => null)
}
