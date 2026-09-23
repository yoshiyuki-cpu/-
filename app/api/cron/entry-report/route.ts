import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isJstSunday } from '@/lib/notify'
import { sendEntryReport } from '@/lib/entryReport'

// 毎日19:30（JST）に、現場ごとの記入状況を社長と難波君にだけ送る。
// 17:30 の記入リマインドの後、入力が落ち着いた時間（入力の7割は17時台、残りも19時台まで）。
// 工事台帳のリマインドと同じく日曜は送らない。
export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (isJstSunday()) return NextResponse.json({ notified: false, reason: 'sunday' })
  const result = await sendEntryReport(supabase)
  return NextResponse.json({ ok: true, ...result })
}
