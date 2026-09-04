import { createSign } from 'crypto'

// Google カレンダーとの連携。サービスアカウント方式。
//
// 社長が Google Cloud でサービスアカウントを作り、その鍵（JSON）を
// Vercel の環境変数 GOOGLE_SERVICE_ACCOUNT_JSON に、対象カレンダーのIDを
// GOOGLE_CALENDAR_ID に入れる。カレンダー側でサービスアカウントのメールに
// 「予定の変更」権限を共有しておく。
//
// googleapis パッケージは使わない。JWT の署名だけ Node の crypto で行い、
// あとは REST を直接叩く。依存を増やさず、動きが読めるようにするため。
// 設定が無ければすべて何もしない（アプリ本体は止めない）。

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
const API_BASE = process.env.GOOGLE_CALENDAR_API_BASE || 'https://www.googleapis.com/calendar/v3'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'

type ServiceAccount = { client_email: string; private_key: string }

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    if (!sa.client_email || !sa.private_key) return null
    // 環境変数に貼ると改行が \n の2文字になっていることがあるので戻す
    return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, '\n') }
  } catch {
    return null
  }
}

export function isGoogleCalendarConfigured() {
  return !!loadServiceAccount() && !!process.env.GOOGLE_CALENDAR_ID
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// サービスアカウントの鍵で署名した JWT。これをトークンと交換する
export function buildJwt(sa: ServiceAccount, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = base64url(signer.sign(sa.private_key))
  return `${header}.${payload}.${signature}`
}

let cached: { token: string; expiresAt: number } | null = null

async function getAccessToken() {
  const sa = loadServiceAccount()
  if (!sa) throw new Error('Google カレンダーの設定がありません')
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJwt(sa),
    }),
  })
  if (!res.ok) throw new Error(`Google token failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 }
  return cached.token
}

function calendarId() {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_ID がありません')
  return encodeURIComponent(id)
}

// YYYY-MM-DD の翌日。終日予定の end.date は「その日を含まない」決まりなので必要
function nextDay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export type CalendarEventInput = { title: string; date: string; description?: string | null }

// 終日予定として入れる。時刻は持たない（アプリ側の予定にも時刻が無いため）
export async function insertEvent(input: CalendarEventInput): Promise<{ id: string; htmlLink: string | null }> {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}/calendars/${calendarId()}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: input.title,
      description: input.description ?? undefined,
      start: { date: input.date },
      end: { date: nextDay(input.date) },
    }),
  })
  if (!res.ok) throw new Error(`Google insert failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return { id: json.id, htmlLink: json.htmlLink ?? null }
}

// 既に消えていれば成功扱い（アプリ側で消した予定をもう一度消しに行っても困らないように）
export async function deleteEvent(googleEventId: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}/calendars/${calendarId()}/events/${encodeURIComponent(googleEventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok || res.status === 404 || res.status === 410) return
  throw new Error(`Google delete failed: ${res.status} ${await res.text()}`)
}

// 接続確認用。直近の予定を少しだけ読む
export async function listUpcoming(max = 5): Promise<{ summary: string; date: string }[]> {
  const token = await getAccessToken()
  const params = new URLSearchParams({
    maxResults: String(max), singleEvents: 'true', orderBy: 'startTime',
    timeMin: new Date().toISOString(),
  })
  const res = await fetch(`${API_BASE}/calendars/${calendarId()}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Google list failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { items?: { summary?: string; start?: { date?: string; dateTime?: string } }[] }
  return (json.items ?? []).map(e => ({
    summary: e.summary ?? '（無題）',
    date: e.start?.date ?? e.start?.dateTime?.slice(0, 10) ?? '',
  }))
}
