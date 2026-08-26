import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { notifyDispatch } from '@/lib/dispatchNotify'
import { isJstSunday } from '@/lib/notify'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 日本時間での翌日。段取りは翌日ぶんを組むので、この日付の段取りを送る
function tomorrowJst(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jstNow.setUTCDate(jstNow.getUTCDate() + 1)
  return jstNow.toISOString().slice(0, 10)
}

// 毎日18:30(JST)に翌日の段取りを職長へ送る。
// 職長が早く決めて手動で「通知する」を押していた場合は、そのあと配員を変えていなければ送らない。
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 翌日が日曜（＝土曜の夕方）は段取りを送らない
  const date = tomorrowJst()
  const [y, m, d] = date.split('-').map(Number)
  if (isJstSunday(new Date(Date.UTC(y, m - 1, d, 3)))) {
    return NextResponse.json({ ok: true, skipped: 'sunday', date })
  }

  const { data: plan } = await supabase
    .from('dispatch_plans').select('id, notified_at').eq('date', date).maybeSingle()

  // 手動で送信済みなら二重に送らない。配員を変えると画面側でnotified_atが消えるため、
  // 変更があった日はここで改めて送られる
  if (plan?.notified_at) {
    return NextResponse.json({ ok: true, skipped: 'already_notified', date })
  }

  const result = await notifyDispatch(supabase, date)
  if (!result.ok) {
    console.error('dispatch reminder skipped:', result.reason, date)
    return NextResponse.json({ ok: true, skipped: result.reason, date })
  }

  return NextResponse.json({ ok: true, date, notified: result.notified, errors: result.errors })
}
