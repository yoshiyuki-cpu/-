import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchForemanTargets, sendReminderEmail, sendReminderPush, sendLineMessage, projectUrl, isJstSunday, notifyTomorrowCalendarEvents } from '@/lib/notify'

export const maxDuration = 30

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 工事台帳の記入リマインドは日曜だけ送らない。
// 一方カレンダーの前日通知は、日曜の夕方に月曜の予定を知らせる必要があるので毎日送る。
async function runEntryReminder() {
  if (isJstSunday()) return 0

  const targets = await fetchForemanTargets(supabase)

  await Promise.all(targets.map(async t => {
    const lines = [
      `${t.name}さん、本日もお疲れさまです。`,
      '工事台帳の記入・写真の貼り付けをお願いします。',
      '',
      ...t.projects.map(p => `【${p.name}】\n記入: ${projectUrl('entry', p.id)}`),
    ]
    if (t.email) await sendReminderEmail(t.email, '【良心アプリ】本日の工事台帳記入・写真貼り付けをお願いします', lines)
    await sendReminderPush(supabase, t.worker_id, '工事台帳の記入', '本日分の工事台帳記入・写真の貼り付けをお願いします', projectUrl('entry', t.projects[0].id))
    if (t.line_user_id) {
      try { await sendLineMessage(t.line_user_id, lines.join('\n')) } catch (e) { console.error('line send failed:', e) }
    }
  }))

  return targets.length
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [entryResult, calendarResult] = await Promise.allSettled([
    runEntryReminder(),
    notifyTomorrowCalendarEvents(supabase),
  ])

  if (entryResult.status === 'rejected') console.error('entry reminder failed:', entryResult.reason)
  if (calendarResult.status === 'rejected') console.error('calendar reminder failed:', calendarResult.reason)

  return NextResponse.json({
    ok: true,
    entryReminder: entryResult.status === 'fulfilled' ? { notified: entryResult.value } : 'rejected',
    calendarReminder: calendarResult.status === 'fulfilled' ? { notified: calendarResult.value } : 'rejected',
  })
}
