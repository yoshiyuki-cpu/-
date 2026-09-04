'use client'
import { useSyncExternalStore } from 'react'

// 画面の見た目の切り替え。
//
// 新しいデザイン（v2）は端末ごとに試せて、いつでも従来（v1）に戻せる。
// 記録には一切触らない。見た目の指定は <html data-design="v2"> に付く属性と
// それを見る CSS・部品だけで、データの形は変えていない。
//
// 端末ごと（localStorage）にしているのは、社長がまず自分の端末で試し、
// 職長の画面を急に変えないため。全員分を切り替えるときは既定値を変える。
export type Design = 'v1' | 'v2'

const KEY = 'ryoshin_design'
const EVENT = 'ryoshin-design-change'
const DEFAULT_DESIGN: Design = 'v1'

export function readDesign(): Design {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'v2' ? 'v2' : DEFAULT_DESIGN
  } catch {
    return DEFAULT_DESIGN
  }
}

export function applyDesign(d: Design) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.design = d
}

export function setDesign(d: Design) {
  try { localStorage.setItem(KEY, d) } catch { /* 保存できない端末では今回だけ効く */ }
  applyDesign(d)
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

// サーバー側の描画では常に v1 とし、端末側で設定を読んで差し替える。
// こうすると最初の描画が一致し、React の警告が出ない
export function useDesign(): Design {
  return useSyncExternalStore(subscribe, readDesign, () => DEFAULT_DESIGN)
}
