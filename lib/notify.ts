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
