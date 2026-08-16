'use client'
import { useEffect, useState } from 'react'
import RyoshinLogo from './RyoshinLogo'

const SEEN_KEY = 'ryoshin-splash-seen'

export default function SplashScreen() {
  // 初回は表示した状態で描画し、セッション内で表示済みならマウント直後に閉じる
  const [visible, setVisible] = useState(true)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(SEEN_KEY)) setVisible(false)
  }, [])

  // 表示中は背後の一覧をスクロールさせない
  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [visible])

  function start() {
    sessionStorage.setItem(SEEN_KEY, '1')
    setClosing(true)
    setTimeout(() => setVisible(false), 400)
  }

  if (!visible) return null

  return (
    <div
      className={`no-print fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white transition-opacity duration-400 ${closing ? 'opacity-0' : 'opacity-100'}`}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* 背景の光と重機シルエット */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-slate-500/20 blur-3xl" />
        <svg viewBox="0 0 200 120" className="absolute -bottom-2 right-0 w-[85%] max-w-sm text-white/[0.07]" fill="currentColor">
          <path d="M126 62 L92 22 L102 14 L138 56 Z" />
          <path d="M96 18 L54 48 L62 60 L104 30 Z" />
          <path d="M58 44 L74 62 L60 74 L40 66 L42 48 Z" />
          <path d="M132 34 L164 34 L168 58 L132 58 Z" />
          <rect x="118" y="58" width="66" height="26" rx="5" />
          <rect x="112" y="86" width="80" height="18" rx="9" />
        </svg>
      </div>

      <div className="relative flex flex-col items-center px-8 text-center">
        <RyoshinLogo className="w-24 h-24 rounded-3xl shadow-lg mb-5" />

        <p className="text-[11px] tracking-[0.3em] text-blue-200/90 font-medium mb-3">
          OKAYAMA · DEMOLITION
        </p>
        <p className="text-lg font-bold tracking-wide mb-6">株式会社良心</p>

        <h1 className="text-[28px] leading-snug font-bold tracking-tight">
          岡山で一番信頼される<br />解体会社を目指そう！！
        </h1>

        <p className="text-sm text-blue-100/70 mt-5 leading-relaxed">
          安全第一・確実な施工で、<br />地域の信頼に応えます。
        </p>

        <button
          onClick={start}
          className="mt-10 px-10 py-3.5 rounded-full bg-white text-slate-900 font-bold text-base shadow-lg active:scale-95 transition"
        >
          はじめる
        </button>
      </div>
    </div>
  )
}
