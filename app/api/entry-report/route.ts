import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendEntryReport, collectSiteStatus, buildEntryReportLines } from '@/lib/entryReport'
import { jstToday } from '@/lib/date'

// 通知設定の「今すぐ送ってみる」「文面を見る」用。自動の19:30便と同じ文面を使う。
export const maxDuration = 60

// 文面だけ見る（送らない）
export async function GET() {
  const date = jstToday()
  const timeLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' }).format(new Date())
  const lines = buildEntryReportLines(await collectSiteStatus(supabase, date), date, timeLabel)
  return NextResponse.json({ text: lines.join('\n') })
}

// 今すぐ送る
export async function POST() {
  const result = await sendEntryReport(supabase)
  return NextResponse.json({ ok: true, ...result })
}
