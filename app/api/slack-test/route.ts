import { NextResponse } from 'next/server'
import { isSlackConfigured, sendSlack } from '@/lib/slack'

// 通知設定画面の「Slackにテスト送信」から呼ばれる。
// 設定が無いときはエラーにせず、その旨を返して画面で案内する
export async function POST() {
  if (!isSlackConfigured()) {
    return NextResponse.json({ ok: false, configured: false, message: 'SLACK_WEBHOOK_URL が設定されていません' })
  }
  try {
    await sendSlack('【良心アプリ】Slack連携のテストです。この通知が見えていれば設定は完了です。')
    return NextResponse.json({ ok: true, configured: true })
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, message: e instanceof Error ? e.message : 'send failed' })
  }
}
