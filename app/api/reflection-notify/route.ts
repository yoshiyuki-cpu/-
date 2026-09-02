import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendReminderEmail } from '@/lib/notify'
import { REFLECTION_NOTIFY_EMAIL_KEY } from '@/lib/passcode'

// 振り返りに記入があったとき、社長に知らせる。
//
// 本文はメールに載せない。メールの通知はロック画面やプレビューに出るため、
// 本人と社長だけが読む前提が崩れる。誰がいつ書いたかだけを知らせ、中身はアプリで見る。
export async function POST(req: NextRequest) {
  const { workerName, kind, date } = await req.json()
  if (!workerName || !date) return NextResponse.json({ error: 'invalid request' }, { status: 400 })

  const { data } = await supabase.from('app_settings')
    .select('value').eq('key', REFLECTION_NOTIFY_EMAIL_KEY)
  const to = (data ?? [])[0]?.value
  // 通知先が未設定でも記入は成功させたいので、エラーにはしない
  if (!to) return NextResponse.json({ ok: true, notified: 0, reason: 'no_recipient' })

  const label = kind === 'good' ? '良かったこと' : '悪かったこと'
  try {
    await sendReminderEmail(to, '【良心アプリ】振り返りの記入がありました', [
      `${workerName}さんが${label}を記録しました。`,
      `対象の日：${date}`,
      '',
      '内容はアプリで確認してください。',
      'マスタ → 🔒 振り返り → 社長 で開けます。',
      '',
      '（内容はこのメールには載せていません）',
    ])
  } catch {
    // 送信に失敗しても記入自体は成功しているので、そこは壊さない
    return NextResponse.json({ ok: true, notified: 0, reason: 'send_failed' })
  }

  return NextResponse.json({ ok: true, notified: 1 })
}
