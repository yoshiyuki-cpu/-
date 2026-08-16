import nodemailer from 'nodemailer'
import webpush from 'web-push'
import { SupabaseClient } from '@supabase/supabase-js'

const APP_URL = process.env.APP_URL || 'https://koji-daichou-zeta.vercel.app'

let vapidConfigured = false
function ensureVapid() {
  if (vapidConfigured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return
  webpush.setVapidDetails('mailto:info@ryoshin-app.local', publicKey, privateKey)
  vapidConfigured = true
}

let transporter: nodemailer.Transporter | null = null
function getTransporter() {
  if (transporter) return transporter
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  return transporter
}

// 日本時間で日曜日かどうか（サーバーはUTCで動くため、JSTの曜日をタイムゾーン変換で判定する）
export function isJstSunday(now = new Date()) {
  const jstWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(now)
  return jstWeekday === 'Sun'
}

export type ForemanTarget = {
  worker_id: number
  name: string
  email: string | null
  line_user_id: string | null
  projects: { id: number; name: string }[]
}

// is_foreman=trueの作業員を、担当現場（アクティブのみ）と一緒に取得する
export async function fetchForemanTargets(supabase: SupabaseClient): Promise<ForemanTarget[]> {
  const { data: foremen } = await supabase.from('workers').select('id, name, email, line_user_id').eq('is_foreman', true)
  if (!foremen || foremen.length === 0) return []

  const { data: links } = await supabase
    .from('foreman_projects')
    .select('worker_id, projects(id, name, status)')
    .in('worker_id', foremen.map(f => f.id))

  return foremen.map(f => ({
    worker_id: f.id,
    name: f.name,
    email: f.email,
    line_user_id: f.line_user_id,
    projects: (links ?? [])
      .filter((l: any) => l.worker_id === f.id && l.projects?.status === 'active')
      .map((l: any) => ({ id: l.projects.id, name: l.projects.name })),
  })).filter(f => f.projects.length > 0)
}

export async function sendReminderEmail(to: string, subject: string, bodyLines: string[]) {
  const t = getTransporter()
  if (!t) return
  await t.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject,
    text: bodyLines.join('\n'),
  })
}

export async function sendReminderPush(supabase: SupabaseClient, workerId: number, title: string, body: string, url: string) {
  ensureVapid()
  if (!vapidConfigured) return
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('worker_id', workerId)
  if (!subs || subs.length === 0) return

  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url })
      )
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        console.error('push send failed:', e)
      }
    }
  }))
}

export async function sendLineMessage(lineUserId: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LINE push failed: ${res.status} ${body}`)
  }
}

export function projectUrl(path: string, projectId: number) {
  return `${APP_URL}/projects/${projectId}/${path}`
}

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  construction_start: '着工', night_shift: '夜勤', estimate: '見積り', other: 'その他',
}

// JSTの翌日の日付（YYYY-MM-DD）
function jstTomorrow(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000)
  jstNow.setUTCDate(jstNow.getUTCDate() + 1)
  return jstNow.toISOString().split('T')[0]
}

// 翌日の予定を、通知先の職長ごとにまとめて送る
export async function notifyTomorrowCalendarEvents(supabase: SupabaseClient) {
  const date = jstTomorrow()
  const { data: events } = await supabase.from('calendar_events').select('*').eq('event_date', date)
  if (!events || events.length === 0) return 0

  const { data: recipientRows } = await supabase
    .from('calendar_event_recipients')
    .select('event_id, worker_id')
    .in('event_id', events.map((e: any) => e.id))

  const { data: foremen } = await supabase
    .from('workers').select('id, name, email, line_user_id').eq('is_foreman', true)
  if (!foremen || foremen.length === 0) return 0

  const byWorker = new Map<number, any[]>()
  events.forEach((e: any) => {
    const targets = e.notify_all
      ? foremen.map((f: any) => f.id)
      : (recipientRows ?? []).filter((r: any) => r.event_id === e.id).map((r: any) => r.worker_id)
    targets.forEach((id: number) => byWorker.set(id, [...(byWorker.get(id) ?? []), e]))
  })

  await Promise.all([...byWorker.entries()].map(async ([workerId, list]) => {
    const worker = foremen.find((f: any) => f.id === workerId)
    if (!worker) return

    const lines = [
      `${worker.name}さん、明日の予定をお知らせします。`,
      '',
      ...list.map((e: any) => {
        const label = CALENDAR_TYPE_LABELS[e.event_type] ?? 'その他'
        return e.note ? `【${label}】${e.title}\n${e.note}` : `【${label}】${e.title}`
      }),
    ]

    if (worker.email) await sendReminderEmail(worker.email, '【良心アプリ】明日の予定', lines)
    await sendReminderPush(supabase, workerId, '明日の予定', list.map((e: any) => e.title).join('、'), `${APP_URL}/calendar`)
    if (worker.line_user_id) {
      try { await sendLineMessage(worker.line_user_id, lines.join('\n')) } catch (e) { console.error('line send failed:', e) }
    }
  }))

  return byWorker.size
}
