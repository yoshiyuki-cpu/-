import type { SupabaseClient } from '@supabase/supabase-js'
import { sendReminderEmail, sendReminderPush, sendLineMessage } from '@/lib/notify'
import { jstToday } from '@/lib/date'
import { REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'
import { GATE_START, TOOLS_START } from '@/lib/morningGate'
import { collectSiteStatus, classify, SiteStatus } from '@/lib/siteStatus'

export { collectSiteStatus, classify }
export type { SiteStatus }

// 夕方の「現場の記入状況」の報告。毎日19:30（夕方の記入リマインド17:30の後）に、
// 社長と、印（workers.receives_entry_report）を付けた人（難波君）にだけ送る。
//
// 現場ごとに、今日の KY活動・議事録・人工・処分代・経費が入っているかを1行にまとめる。
// 「記録が何も無い現場」は休工の日もあるので、抜けとは分けて最後に並べる。

export const OWNER_LINE_USER_ID_KEY = 'owner_line_user_id'
export const OWNER_LINE_LINK_CODE_KEY = 'owner_line_link_code'

const APP_URL = process.env.APP_URL || 'https://koji-daichou-zeta.vercel.app'

const mark = (b: boolean) => (b ? '○' : '×')

export function buildEntryReportLines(statuses: SiteStatus[], date: string, timeLabel: string): string[] {
  const [y, m, d] = date.split('-').map(Number)
  const wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const missing = statuses.filter(s => classify(s) === 'missing')
  const done = statuses.filter(s => classify(s) === 'done')
  const none = statuses.filter(s => classify(s) === 'none')
  const detail = (s: SiteStatus) =>
    `KY${mark(s.ky)} 議事録${mark(s.minutes)}${s.toolsRequired ? ` 道具${mark(s.tools)}` : ''} 人工${s.labor > 0 ? `${s.labor}名` : '×'} 処分${s.waste > 0 ? `${s.waste}件` : 'なし'}${s.other > 0 ? ` 経費${s.other}件` : ''}${s.unlocked ? '（社長が解除）' : ''}`

  const lines = [`📋 ${m}/${d}(${wd}) 現場の記入状況（${timeLabel}時点）`, '']
  if (missing.length) {
    lines.push(`■ 抜けがある現場 ${missing.length}`)
    for (const s of missing) lines.push(`【${s.name}】`, `　${detail(s)}`)
    lines.push('')
  }
  if (done.length) {
    lines.push(`■ 記入済み ${done.length}`)
    for (const s of done) lines.push(`【${s.name}】`, `　${detail(s)}`)
    lines.push('')
  }
  if (none.length) {
    lines.push(`■ 今日の記録なし（休工？） ${none.length}`, `　${none.map(s => s.name).join('、')}`, '')
  }
  if (!statuses.length) lines.push('進行中の現場がありません。', '')
  if (date >= GATE_START) lines.push(`※KY活動・議事録${date >= TOOLS_START ? '・道具の確認' : ''}が済んでいない現場は、人工・処分代を入力できない設定です。`)
  lines.push(`アプリ：${APP_URL}`)
  return lines
}

export type ReportResult = { sites: number; missing: number; sentTo: string[]; skipped: string[] }

// 集計して、社長と受け取る人に送る。1人分の失敗で全体を止めない
export async function sendEntryReport(supabase: SupabaseClient, now = new Date()): Promise<ReportResult> {
  const date = jstToday(now)
  const timeLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' }).format(now)
  const statuses = await collectSiteStatus(supabase, date)
  const lines = buildEntryReportLines(statuses, date, timeLabel)
  const text = lines.join('\n')
  const subject = `【良心アプリ】${date.slice(5).replace('-', '/')} 現場の記入状況`
  const sentTo: string[] = []
  const skipped: string[] = []

  // 社長：LINE が連携してあれば LINE、なければ振り返りの通知先メール
  const { data: settings } = await supabase.from('app_settings').select('key, value')
    .in('key', [OWNER_LINE_USER_ID_KEY, REFLECTION_NOTIFY_EMAIL_KEY])
  const ownerLine = settings?.find(s => s.key === OWNER_LINE_USER_ID_KEY)?.value
  const ownerEmail = settings?.find(s => s.key === REFLECTION_NOTIFY_EMAIL_KEY)?.value
  try {
    if (ownerLine) { await sendLineMessage(ownerLine, text); sentTo.push('社長（LINE）') }
    else if (ownerEmail) { await sendReminderEmail(ownerEmail, subject, lines); sentTo.push('社長（メール）') }
    else skipped.push('社長（LINE もメールも未設定）')
  } catch (e) { console.error('entry report to owner failed:', e); skipped.push('社長（送信に失敗）') }

  // 受け取る人（難波君など）。列が無い環境（SQL 未実行）でも落ちないよう、全部取って JS で絞る
  const { data: workers } = await supabase.from('workers').select('*')
  const receivers = (workers ?? []).filter((w: { receives_entry_report?: boolean }) => w.receives_entry_report === true) as
    { id: number; name: string; email: string | null; line_user_id: string | null }[]
  for (const w of receivers) {
    try {
      if (w.line_user_id) { await sendLineMessage(w.line_user_id, text); sentTo.push(`${w.name}（LINE）`) }
      else if (w.email) { await sendReminderEmail(w.email, subject, lines); sentTo.push(`${w.name}（メール）`) }
      else skipped.push(`${w.name}（LINE もメールも未設定。プッシュのみ）`)
      await sendReminderPush(supabase, w.id, '現場の記入状況', lines[0], APP_URL)
    } catch (e) { console.error('entry report failed:', w.name, e); skipped.push(`${w.name}（送信に失敗）`) }
  }

  return { sites: statuses.length, missing: statuses.filter(s => classify(s) === 'missing').length, sentTo, skipped }
}
