'use client'
import { useLayout } from '@/lib/layout'
import Today from './Today'
import SiteList from './SiteList'

// ホーム。新しい画面では「今日」、前の画面（マスタで戻した端末）では従来どおり現場の一覧
export default function HomePage() {
  const layout = useLayout()
  if (layout === null) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  return layout === 'classic' ? <SiteList /> : <Today />
}
