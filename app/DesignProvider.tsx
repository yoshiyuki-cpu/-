'use client'
import { useEffect } from 'react'
import { applyDesign, useDesign } from '@/lib/design'

// 端末に保存されたデザイン設定を <html> に反映する。
// 画面が出る前に反映したいので、layout 側に入れた小さなスクリプトでも同じことをしている。
// ここは設定が変わったときの追従用
export default function DesignProvider() {
  const design = useDesign()
  useEffect(() => { applyDesign(design) }, [design])
  return null
}
