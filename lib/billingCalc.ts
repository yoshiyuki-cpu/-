// 請求書の計算。画面やDBに触らない。社長の見本3枚で1円まで合わせてある。
// scripts/check-billing-calc.mjs で検算できる（公開リポジトリなので金額は架空）。
//
// 工事代金：金額は税込で入れる。単価の欄は税込÷1.1を四捨五入した税抜額（数量は1式）
// 常用工事：金額は数量×単価で税抜。この分だけ別に10%を足して税込合計へ入れる
// 小計は税込合計÷1.1の四捨五入、消費税は合計−小計

export type LineType = 'construction' | 'daily'

export type CalcLine = {
  line_type: LineType
  quantity: number
  unit_price: number | null
  amount: number
}

// 税込額から税抜額へ。×10÷11 にすると小数の誤差が出ず、ちょうど .5 になることもない
export function excludeTax(taxIncluded: number) {
  return Math.round((taxIncluded * 10) / 11)
}

export function dailyAmount(quantity: number, unitPrice: number) {
  return Math.round(quantity * unitPrice)
}

// 明細の「単価」の欄に出す値
export function displayUnitPrice(line: CalcLine) {
  if (line.line_type === 'construction') return excludeTax(line.amount)
  return line.unit_price ?? 0
}

export type InvoiceTotals = { subtotal: number; tax: number; total: number; taxRate: 10 }

export function calcTotals(lines: Pick<CalcLine, 'line_type' | 'amount'>[]): InvoiceTotals {
  const included = lines.filter(l => l.line_type === 'construction').reduce((s, l) => s + l.amount, 0)
  const excluded = lines.filter(l => l.line_type === 'daily').reduce((s, l) => s + l.amount, 0)
  const total = included + Math.round((excluded * 11) / 10)
  const subtotal = excludeTax(total)
  return { subtotal, tax: total - subtotal, total, taxRate: 10 }
}

// 'YYYY-MM' の月末を 'YYYY-MM-DD' で返す。offset で先の月にずらす
export function monthEnd(month: string, offset = 0) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m + offset, 0))
  return d.toISOString().split('T')[0]
}

// 請求日は月末、支払期限は翌月末（見本3枚とも同じ）
export function defaultInvoiceDates(month: string) {
  return { issue_date: monthEnd(month), due_date: monthEnd(month, 1) }
}

// 'YYYY-MM' の前の月
export function prevMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return d.toISOString().slice(0, 7)
}

// 現場の住所から品名の初期値を作る。番地から後ろは請求書に載せない
// 例：岡山市北区東古松1-2-3 → 岡山市北区東古松地内　工事代金
export function defaultItemName(location: string | null | undefined) {
  const area = (location ?? '').trim().replace(/[\s　]*[0-9０-９].*$/, '')
  return area ? `${area}地内　工事代金` : ''
}

// 会社名の株式会社などを除いた呼び名。現場名から元請の候補を探すときだけ使う
export function shortCompanyName(name: string) {
  return name.replace(/株式会社|有限会社|合同会社|㈱|㈲/g, '').replace(/[\s　]/g, '')
}
