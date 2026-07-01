import { Estimate, EstimateExtraItem, EstimateWasteItem } from './supabase'

export const STRUCTURE_OPTIONS = ['木造', '軽量鉄骨造', '重量鉄骨造', 'RC造', 'ブロック造', 'その他']

export const INCIDENTAL_PRESETS = ['足場', '養生', '重機回送', 'アスベスト調査', '仮設電気・水道', '整地']

export function calcEstimateTotals(
  estimate: Pick<Estimate, 'building_amount' | 'expense_rate' | 'discount_amount' | 'tax_rate'>,
  wasteItems: Pick<EstimateWasteItem, 'quantity' | 'unit_price'>[],
  extraItems: Pick<EstimateExtraItem, 'amount'>[]
) {
  const wasteTotal = wasteItems.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0)
  const extraTotal = extraItems.reduce((sum, i) => sum + Number(i.amount), 0)
  const subtotal = Number(estimate.building_amount) + wasteTotal + extraTotal
  const expenseAmount = Math.round(subtotal * (Number(estimate.expense_rate) / 100))
  const afterDiscount = subtotal + expenseAmount - Number(estimate.discount_amount)
  const taxAmount = Math.round(afterDiscount * (Number(estimate.tax_rate) / 100))
  const total = afterDiscount + taxAmount

  return { wasteTotal, extraTotal, subtotal, expenseAmount, afterDiscount, taxAmount, total }
}
