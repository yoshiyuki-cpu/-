import { Estimate, EstimateCategory, EstimateItem } from './supabase'

export const CATEGORIES: { key: EstimateCategory; label: string }[] = [
  { key: 'demolition', label: '解体工事代金' },
  { key: 'temporary', label: '仮設工事代金' },
  { key: 'disposal', label: '産業廃棄物処理費' },
  { key: 'finishing', label: '仕上げ工事代金' },
  { key: 'other', label: 'その他諸経費' },
]

export const UNIT_OPTIONS = ['式', '坪', '㎡', '㎥', '人工', '台', 'トン', 'kg', '枚', '本', '箇所']

export function categoryLabel(category: EstimateCategory) {
  return CATEGORIES.find(c => c.key === category)?.label ?? category
}

export function itemAmount(item: Pick<EstimateItem, 'quantity' | 'unit_price'>) {
  return Number(item.quantity) * Number(item.unit_price)
}

export function calcEstimateTotals(
  estimate: Pick<Estimate, 'tax_rate'>,
  items: Pick<EstimateItem, 'category' | 'quantity' | 'unit_price'>[]
) {
  const byCategory: Record<EstimateCategory, number> = {
    demolition: 0, temporary: 0, disposal: 0, finishing: 0, other: 0,
  }
  for (const item of items) {
    byCategory[item.category] += itemAmount(item)
  }
  const subtotal = Object.values(byCategory).reduce((a, b) => a + b, 0)
  const taxAmount = Math.round(subtotal * (Number(estimate.tax_rate) / 100))
  const total = subtotal + taxAmount

  return { byCategory, subtotal, taxAmount, total }
}
