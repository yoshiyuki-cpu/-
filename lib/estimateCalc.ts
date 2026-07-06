import { Estimate, EstimateItem } from './supabase'

export const UNIT_OPTIONS = ['式', '坪', '㎡', '㎥', '人工', '台', 'トン', 'kg', '枚', '本', '箇所']

// 内訳明細(カテゴリ別)形式で使う固定5カテゴリ。表紙にはカテゴリごとの集計行が並び、
// 解体工事代金と産業廃棄物処理費はそれぞれ単独の内訳ページ、残り3つは1ページにまとめて表示する
export const ESTIMATE_CATEGORIES = ['解体工事代金', '仮設工事代金', '産業廃棄物処理費', '仕上げ工事代金', 'その他諸経費'] as const
export type EstimateCategory = typeof ESTIMATE_CATEGORIES[number]
export const SOLO_DETAIL_CATEGORIES: EstimateCategory[] = ['解体工事代金', '産業廃棄物処理費']
export const COMBINED_DETAIL_CATEGORIES: EstimateCategory[] = ['仮設工事代金', '仕上げ工事代金', 'その他諸経費']

export const ITEM_PRESETS = [
  '躯体部分撤去費', '躯体部分処分費(廃木、土壁、廃プラ等)', '基礎部分撤去費', '基礎部分処分費(コンガラ、瓦礫)',
  '屋根材部分撤去費', '屋根材部分処分費(瓦礫等)', '整地仕上げ費', '植栽、外構撤去処分費',
  '仮設足場養生費', '重機回送費', '石綿事前調査費', '機器損料', '運搬諸経費', '産業廃棄物処理費',
]

export function itemAmount(item: Pick<EstimateItem, 'quantity' | 'unit_price'>) {
  return Number(item.quantity) * Number(item.unit_price)
}

export function calcEstimateTotals(
  estimate: Pick<Estimate, 'tax_rate'>,
  items: Pick<EstimateItem, 'quantity' | 'unit_price'>[]
) {
  const subtotal = items.reduce((sum, i) => sum + itemAmount(i), 0)
  const taxAmount = Math.round(subtotal * (Number(estimate.tax_rate) / 100))
  const total = subtotal + taxAmount

  return { subtotal, taxAmount, total }
}

export function formatDateJp(dateStr: string | null | undefined) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr
  return `${y}.${Number(m)}.${Number(d)}`
}
