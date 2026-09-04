import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { buildMonthlyReport, monthlyReportLines } from '@/lib/monthlyReport'
import { sendReminderEmail } from '@/lib/notify'
import { sendSlack } from '@/lib/slack'
import { REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'

const APP_URL = process.env.APP_URL || 'https://koji-daichou-zeta.vercel.app'

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 毎日 22:00 UTC（翌 07:00 JST）に呼ばれ、日本時間で1日の朝だけ先月分を送る。
// Vercel の cron は月末の指定ができないので、毎日呼んで日付で判断する。
// ?force=1 を付けると日付に関係なく送る（設定の確認用）
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const jst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [y, m, d] = jst.split('-').map(Number)
  const force = req.nextUrl.searchParams.get('force') === '1'
  if (d !== 1 && !force) return NextResponse.json({ skipped: true, reason: 'not_first_day', jst })

  // 先月
  const prev = new Date(Date.UTC(y, m - 2, 1))
  const year = prev.getUTCFullYear(), month = prev.getUTCMonth() + 1

  const report = await buildMonthlyReport(supabase, year, month)
  const lines = monthlyReportLines(report, APP_URL)

  const { data } = await supabase.from('app_settings').select('value').eq('key', REFLECTION_NOTIFY_EMAIL_KEY)
  const to = (data ?? [])[0]?.value
  const results: Record<string, string> = {}
  if (to) {
    try { await sendReminderEmail(to, `【良心アプリ】${year}年${month}月の月次レポート`, lines); results.email = 'sent' }
    catch (e) { results.email = e instanceof Error ? e.message : 'failed' }
  } else {
    results.email = 'no_recipient'
  }
  try { results.slack = (await sendSlack(lines.join('\n'))) ? 'sent' : 'not_configured' }
  catch (e) { results.slack = e instanceof Error ? e.message : 'failed' }

  return NextResponse.json({ ok: true, year, month, sites: report.sites.length, total: report.totals.total, results })
}
