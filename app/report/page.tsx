'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { COST_CATS, fmtYen } from '@/lib/dailyCost'
import { buildMonthlyReport, MonthlyReport } from '@/lib/monthlyReport'

function ReportInner() {
  const params = useSearchParams()
  const [ty, tm] = jstToday().split('-').map(Number)
  // 指定が無ければ先月（月初に見るものなので）
  const prev = new Date(ty, tm - 2, 1)
  const [year, setYear] = useState(Number(params.get('y')) || prev.getFullYear())
  const [month, setMonth] = useState(Number(params.get('m')) || prev.getMonth() + 1)
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [saving, setSaving] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  // 表示中の月の集計がまだ来ていなければ「集計中」
  const loading = !report || report.year !== year || report.month !== month

  useEffect(() => {
    let cancelled = false
    buildMonthlyReport(supabase, year, month).then(r => { if (!cancelled) setReport(r) })
    return () => { cancelled = true }
  }, [year, month])

  function shift(diff: number) {
    const d = new Date(year, month - 1 + diff, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1)
  }

  // 見積書と同じやり方（html2canvas-pro + jspdf）。日本語フォントを埋め込まずに済む
  async function savePdf() {
    if (!sheetRef.current) return
    setSaving(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')])
      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const w = 210, h = (canvas.height * w) / canvas.width
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, Math.min(h, 297))
      pdf.save(`月次レポート_${year}年${month}月.pdf`)
    } catch {
      alert('PDFを作れませんでした。「印刷」からPDFとして保存してください。')
    }
    setSaving(false)
  }

  const r = report
  const sign = (n: number) => (n >= 0 ? '+' : '') + fmtYen(n)

  return (
    <div>
      <div className="no-print flex items-center justify-between mb-3">
        <button onClick={() => shift(-1)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">← 前月</button>
        <h1 className="text-lg font-bold">{year}年{month}月</h1>
        <button onClick={() => shift(1)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">翌月 →</button>
      </div>
      <div className="no-print flex gap-2 mb-4">
        <button onClick={savePdf} disabled={saving || loading || !r}
          className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-40">
          {saving ? '作成中...' : 'PDFで保存'}
        </button>
        <button onClick={() => window.print()} disabled={loading || !r}
          className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40">
          印刷
        </button>
      </div>

      {loading && <p className="text-center py-10 text-gray-500">集計中...</p>}

      {!loading && r && (
        <div ref={sheetRef} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 print:shadow-none print:border-0">
          <div className="flex justify-between items-baseline mb-1">
            <h2 className="text-xl font-bold">月次レポート</h2>
            <span className="text-sm text-gray-500">{year}年{month}月</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">株式会社良心　記録のある日 {r.daysWithRecords}日・現場 {r.sites.length}件</p>

          {/* 3つ横に並べると390px幅で金額が折れるので、縦に並べる */}
          <div className="flex flex-col gap-1 mb-5 text-sm">
            <div className="flex justify-between items-center rounded-xl bg-red-50 px-3 py-2">
              <span className="text-gray-600">支出合計</span>
              <span className="font-bold text-red-700">{fmtYen(r.totals.total)}</span>
            </div>
            <div className="flex justify-between items-center rounded-xl bg-blue-50 px-3 py-2">
              <span className="text-gray-600">スクラップ収益</span>
              <span className="font-bold text-blue-700">{fmtYen(r.totals.scrap)}</span>
            </div>
            <div className={`flex justify-between items-center rounded-xl px-3 py-2 ${r.totals.profit >= 0 ? 'bg-emerald-50' : 'bg-gray-100'}`}>
              <span className="text-gray-600">差引</span>
              <span className={`font-bold ${r.totals.profit >= 0 ? 'text-emerald-700' : 'text-gray-700'}`}>{sign(r.totals.profit)}</span>
            </div>
          </div>

          <h3 className="text-sm font-bold text-gray-700 mb-1">区分別</h3>
          <table className="w-full text-sm mb-5">
            <tbody>
              {COST_CATS.map(c => (
                <tr key={c} className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-600">{c}</td>
                  <td className="py-1.5 text-right">{fmtYen(r.totals.cost[c])}</td>
                </tr>
              ))}
              <tr className="font-bold"><td className="py-1.5">支出合計</td><td className="py-1.5 text-right text-red-700">{fmtYen(r.totals.total)}</td></tr>
            </tbody>
          </table>

          <h3 className="text-sm font-bold text-gray-700 mb-1">現場別（支出の多い順）</h3>
          {r.sites.length === 0 && <p className="text-sm text-gray-400 py-4">この月の記録はありません。</p>}
          {/* 8列の表は390px幅で数字がくっつくので、現場ごとの2行にする。PDFでもそのまま読める */}
          <div className="flex flex-col divide-y divide-gray-100">
            {r.sites.map(s => (
              <div key={s.projectId} className="py-2" data-site-row>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-sm font-medium min-w-0 truncate">{s.projectName}<span className="text-gray-400 font-normal text-xs">　{s.days}日</span></span>
                  <span className="text-sm font-bold text-red-700 whitespace-nowrap" data-site-total>{s.total.toLocaleString()}円</span>
                </div>
                <div className="flex justify-between items-baseline gap-2 text-[11px] text-gray-500">
                  <span className="min-w-0">
                    廃材 {s.cost.廃材処分.toLocaleString()}・人工 {s.cost.人工.toLocaleString()}・車両燃料 {(s.cost.車両代 + s.cost.燃料代).toLocaleString()}・経費 {s.cost.経費.toLocaleString()}
                    {s.scrap > 0 && <>・<span className="text-blue-700">スクラップ {s.scrap.toLocaleString()}</span></>}
                  </span>
                  <span className={`whitespace-nowrap font-medium ${s.profit >= 0 ? 'text-emerald-700' : 'text-gray-600'}`}>差引 {(s.profit >= 0 ? '+' : '') + s.profit.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-4">金額は円・税込。日別の費用・現場詳細の集計と同じ計算です。</p>
        </div>
      )}
    </div>
  )
}

export default function ReportPage() {
  return <Suspense fallback={<p className="text-center py-10 text-gray-500">読み込み中...</p>}><ReportInner /></Suspense>
}
