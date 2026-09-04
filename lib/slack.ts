// Slack への通知。Incoming Webhook（チャンネルに投稿するURL）を1本だけ使う。
//
// Bot Token 方式より設定が簡単で、社長がSlackの画面で発行したURLを
// Vercel の環境変数 SLACK_WEBHOOK_URL に入れるだけで動く。
// URLが無ければ何もしない（LINE・メールと同じく、無くてもアプリは動く）。
const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL

export function isSlackConfigured() {
  return !!WEBHOOK_URL
}

// 送れなかったときは投げる。呼ぶ側で握って、通知の失敗で本体の処理を止めないようにする
export async function sendSlack(text: string): Promise<boolean> {
  if (!WEBHOOK_URL) return false
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Slack send failed: ${res.status} ${body}`)
  }
  return true
}
