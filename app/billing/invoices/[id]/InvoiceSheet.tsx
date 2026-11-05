'use client'
import { forwardRef } from 'react'
import { BillingEntry, BillingSettings } from '@/lib/billing'
import { calcTotals, displayUnitPrice } from '@/lib/billingCalc'

// 社長の見本と同じ形の請求書。A4横1枚を1120×790で描く。
// html2canvas でPDFにするので、色と大きさは実際の値で直接書く
const BLUE = '#8EA9DB'
const STRIPE = '#D9E1F2'
const ROWS_PER_PAGE = 11
const ROW_H = 32

export type SheetData = {
  client: { name: string; postal_code: string | null; address: string | null; honorific: string }
  settings: BillingSettings | null
  invoiceNo: string
  issueDate: string
  dueDate: string
  note: string | null
  lines: BillingEntry[]
}

const wareki = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return `${y}年${m}月${d}日`
}
const n = (v: number) => Number(v).toLocaleString()

// 11行で収まらない分は次のページへ続ける。空でも1ページは出す
export function pageCount(lineCount: number) {
  return Math.max(1, Math.ceil(lineCount / ROWS_PER_PAGE))
}

const label: React.CSSProperties = { background: BLUE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }

type Props = { data: SheetData; page: number }

const InvoiceSheet = forwardRef<HTMLDivElement, Props>(function InvoiceSheet({ data, page }, ref) {
  const { client, settings: s, lines } = data
  const totals = calcTotals(lines)
  const pages = pageCount(lines.length)
  const rows = lines.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)
  const last = page === pages - 1
  const blank = Array.from({ length: ROWS_PER_PAGE - rows.length })
  const account = [s?.account_type ? `(${s.account_type})` : '', s?.account_number ?? ''].join('')

  return (
    <div ref={ref} className="invoice-sheet" style={{ width: 1120, height: 790, background: '#fff', color: '#222', padding: '56px 48px 0', boxSizing: 'border-box', fontFamily: '"Yu Gothic", "Hiragino Sans", "Noto Sans JP", sans-serif', position: 'relative', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 54 }}>
        {/* 宛先 */}
        <div style={{ width: 350 }}>
          <div style={{ border: `3px solid ${BLUE}`, borderRadius: 26, height: 146, padding: '14px 12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, paddingLeft: 16 }}>{client.postal_code ? `〒${client.postal_code}` : ''}</div>
            <div style={{ fontSize: 16, marginTop: 6 }}>{client.address ?? ''}</div>
            <div style={{ fontSize: 21, marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{client.name}</span><span style={{ whiteSpace: 'nowrap' }}>{client.honorific}</span>
            </div>
          </div>
          <div style={{ fontSize: 15, color: '#1f6fd6', marginTop: 12 }}>下記のとおり御請求申し上げます。</div>
        </div>
        {/* 表題と発行者 */}
        <div style={{ flex: 1 }}>
          <div style={{ ...label, height: 42, fontSize: 28, letterSpacing: 18 }}>請 求 書</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, fontSize: 14 }}>
            <div style={{ width: 80 }}>
              <div style={{ ...label, height: 20 }}>請求No.</div>
              <div style={{ ...label, height: 24, marginTop: 3 }}>請求日</div>
            </div>
            <div style={{ width: 142, marginLeft: 3, textAlign: 'center' }}>
              <div style={{ height: 20, borderBottom: `2px solid ${BLUE}` }}>{data.invoiceNo}</div>
              <div style={{ height: 24, marginTop: 3, lineHeight: '24px' }}>{wareki(data.issueDate)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <div style={{ fontSize: 13, textAlign: 'right' }}>
              <div style={{ fontSize: 19, textAlign: 'left' }}>{s?.issuer_name ?? ''}</div>
              <div style={{ marginTop: 6 }}>{s?.postal_code ? `〒${s.postal_code}　　` : ''}{s?.address ?? ''}</div>
              <div style={{ marginTop: 6 }}>{s?.office_name ?? ''}</div>
              <div style={{ marginTop: 8, fontWeight: 700 }}>{s?.tel ? `TEL : ${s.tel}` : ''}</div>
            </div>
            <div style={{ width: 106, height: 106, marginLeft: 26, flexShrink: 0 }}>
              {s?.stamp_data && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.stamp_data} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 合計と振込先 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 8, gap: 14 }}>
        <div style={{ width: 738 }}>
          <div style={{ textAlign: 'right', fontSize: 14, marginBottom: 8, paddingRight: 28 }}>{s?.invoice_registration_no ? `インボイス番号 : ${s.invoice_registration_no}` : ''}</div>
          <div style={{ display: 'flex', height: 38, fontSize: 14 }}>
            <div style={{ ...label, width: 66 }}>合計金額</div>
            <div style={{ width: 240, background: STRIPE, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: 27, fontWeight: 700, paddingRight: 18 }}>¥{n(totals.total)}</div>
            <div style={{ width: 52, background: '#D5DCE4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>税込</div>
            <div style={{ ...label, width: 78, marginLeft: 3 }}>お支払期限</div>
            <div style={{ width: 222, background: STRIPE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{wareki(data.dueDate)}</div>
          </div>
        </div>
        <div style={{ width: 272, border: `2px solid ${BLUE}`, fontSize: 13, boxSizing: 'border-box' }}>
          <div style={{ height: 27, lineHeight: '27px', textAlign: 'center', borderBottom: `2px solid ${BLUE}`, whiteSpace: 'nowrap', overflow: 'hidden' }}>[振込先]　{s?.bank_name ?? ''}　{s?.bank_branch ?? ''}</div>
          <div style={{ height: 34, lineHeight: '34px', textAlign: 'center', fontSize: 14 }}>口座番号／{account}</div>
        </div>
      </div>

      {/* 明細 */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
        <div style={{ width: 738, fontSize: 15 }}>
          <div style={{ display: 'flex', height: 34, gap: 3 }}>
            <div style={{ ...label, width: 228 }}>品　　名</div>
            <div style={{ ...label, width: 62 }}>数量</div>
            <div style={{ ...label, width: 46 }}>単位</div>
            <div style={{ ...label, width: 70 }}>単価</div>
            <div style={{ ...label, width: 80 }}>金　額</div>
            <div style={{ ...label, flex: 1 }}>摘　要</div>
          </div>
          {rows.map((l, i) => (
            <div key={l.id} style={{ display: 'flex', height: ROW_H, gap: 3, alignItems: 'stretch', background: 'transparent' }}>
              {/* 品名は欠けると困るので、長いものは文字を小さくして2行に折り返す */}
              <div style={{ width: 228, flexShrink: 0, background: i % 2 ? STRIPE : '#fff', fontSize: l.item_name.length > 36 ? 10 : l.item_name.length > 22 ? 11 : l.item_name.length > 18 ? 13 : 15, lineHeight: l.item_name.length > 22 ? '14px' : `${ROW_H}px`, padding: l.item_name.length > 22 ? '2px 5px' : '0 5px', boxSizing: 'border-box', overflow: 'hidden', overflowWrap: 'anywhere' }}>{l.item_name}</div>
              {[
                { w: 62, t: Number(l.quantity).toFixed(1), a: 'right' as const },
                { w: 46, t: l.unit, a: 'center' as const, f: 13 },
                { w: 70, t: n(displayUnitPrice(l)), a: 'right' as const, f: 13 },
                { w: 80, t: n(l.amount), a: 'right' as const },
              ].map((c, j) => (
                <div key={j} style={{ width: c.w, flexShrink: 0, background: i % 2 ? STRIPE : '#fff', textAlign: c.a, lineHeight: `${ROW_H}px`, fontSize: c.f ?? 15, padding: '0 5px', boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden' }}>{c.t}</div>
              ))}
              <div style={{ flex: 1, background: i % 2 ? STRIPE : '#fff', fontSize: 13, lineHeight: `${ROW_H}px`, padding: '0 5px', whiteSpace: 'nowrap', overflow: 'hidden' }}>{l.note ?? ''}</div>
            </div>
          ))}
          {blank.map((_, i) => {
            const stripe = (rows.length + i) % 2 === 1
            return (
              <div key={i} style={{ display: 'flex', height: ROW_H, gap: 3 }}>
                {[228, 62, 46, 70, 80].map((w, j) => <div key={j} style={{ width: w, flexShrink: 0, background: stripe ? STRIPE : '#fff' }} />)}
                <div style={{ flex: 1, background: stripe ? STRIPE : '#fff' }} />
              </div>
            )
          })}
        </div>
        {/* 備考と合計 */}
        <div style={{ width: 272, fontSize: 15 }}>
          <div style={{ ...label, height: 34 }}>備　　考</div>
          <div style={{ height: ROW_H * 6, fontSize: 13, padding: 6, boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{data.note ?? ''}</div>
          {[
            { k: '税込金額', v: '' },
            { k: '小　計', v: last ? n(totals.subtotal) : '' },
            { k: '税　率', v: last ? `${totals.taxRate}%` : '' },
            { k: '消費税', v: last ? n(totals.tax) : '' },
            { k: '合　計', v: last ? n(totals.total) : '', b: true },
          ].map(r => (
            <div key={r.k} style={{ display: 'flex', height: ROW_H, gap: 3 }}>
              <div style={{ ...label, width: 100 }}>{r.k}</div>
              <div style={{ flex: 1, background: STRIPE, textAlign: 'right', lineHeight: `${ROW_H}px`, padding: '0 10px', fontWeight: r.b ? 700 : 400, fontSize: r.b ? 17 : 15 }}>{r.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: BLUE, height: 30, marginTop: 4 }} />
      {pages > 1 && <div style={{ position: 'absolute', right: 48, bottom: 14, fontSize: 12, color: '#666' }}>{page + 1} / {pages}</div>}
    </div>
  )
})

export default InvoiceSheet
