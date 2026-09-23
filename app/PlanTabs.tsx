'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 下の帯の「予定」の中身。予定（カレンダー）・段取り・出面は「いつ・誰が・どこへ」の話なので、
// 3つを行き来できるように各画面の一番上に並べる。
const ITEMS = [
  { href: '/calendar', label: '予定' },
  { href: '/dispatch', label: '段取り' },
  { href: '/attendance', label: '出面' },
]

export default function PlanTabs() {
  const pathname = usePathname()
  return (
    <nav className="no-print grid grid-cols-3 gap-1 bg-gray-200/70 rounded-xl p-1 mb-4" aria-label="予定の切り替え">
      {ITEMS.map(i => {
        const on = pathname.startsWith(i.href)
        return (
          <Link key={i.href} href={i.href}
            className={`text-center py-2 rounded-lg text-sm font-bold transition ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
