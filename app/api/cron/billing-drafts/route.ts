import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendReminderEmail } from '@/lib/notify'
import { REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'
import { countUnassigned, createDraftsForMonth, fetchMembers, isNotReady } from '@/lib/billing'
import { prevMonth } from '@/lib/billingCalc'

const APP_URL = process.env.APP_URL || 'https://koji-daichou-zeta.vercel.app'

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 毎日 21:00 UTC（翌 06:00 JST）に呼ばれ、日本時間で1日の朝だけ先月分の下書きを作る。
// Vercel の cron は月末の指定ができないので、monthly-report と同じく毎日呼んで日付で判断する。
// 通知に金額や元請名は入れない。?force=1 を付けると日付に関係なく動く（確認用）
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const jst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const force = req.nextUrl.searchParams.get('force') === '1'
  if (Number(jst.split('-')[2]) !== 1 && !force) return NextResponse.json({ skipped: true, reason: 'not_first_day', jst })

  const month = prevMonth(jst.slice(0, 7))
  try {
    const drafts = await createDraftsForMonth(month)
    const unassigned = await countUnassigned()
    // 二度目の実行で同じ通知を送らない
    if (drafts.created === 0 && !force) return NextResponse.json({ ok: true, month, ...drafts, unassigned, email: 'no_new_drafts' })

    const members = await fetchMembers()
    const { data } = await supabase.from('app_settings').select('value').eq('key', REFLECTION_NOTIFY_EMAIL_KEY)
    const recipients = new Set<string>(members.filter(m => m.active && m.role === 'confirm' && m.email).map(m => m.email as string))
    const owner = (data ?? [])[0]?.value
    if (owner) recipients.add(owner)

    const [y, m] = month.split('-').map(Number)
    const lines = [
      `${y}年${m}月分の請求書の下書きが${drafts.created}通できました。内容を確認して確定してください。`,
      ...(unassigned > 0 ? [`請求月か元請が未選択の売上が${unassigned}件あり、請求書に載っていません。`] : []),
      '',
      `${APP_URL}/billing`,
    ]
    const results: Record<string, string> = {}
    for (const to of recipients) {
      try { await sendReminderEmail(to, `【良心アプリ】${y}年${m}月分の請求書の下書き`, lines); results[to] = 'sent' }
      catch (e) { results[to] = e instanceof Error ? e.message : 'failed' }
    }
    return NextResponse.json({ ok: true, month, ...drafts, unassigned, sent: Object.values(results).filter(v => v === 'sent').length })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'failed'
    // SQL未実行のあいだは何もしない
    return NextResponse.json({ ok: false, month, notReady: isNotReady({ message }) || message.includes('supabase-schema-billing'), message })
  }
}
