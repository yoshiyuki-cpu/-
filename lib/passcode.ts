// 合言葉の扱い。
//
// 画面を隠すための合言葉なので、DBには平文を置かずハッシュだけを持つ。
// 合言葉を使い回している人がいても、DBを見られたときに他で使えないようにするため。
// （本文そのものは暗号化していないので、DBを直接見られれば読める。画面での目隠しまで）
export async function hashPasscode(scope: string, passcode: string) {
  const data = new TextEncoder().encode(`${scope}:${passcode}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// 職長ごとに違うハッシュになるよう、作業員のIDを混ぜる
export const workerScope = (workerId: number) => `worker-${workerId}`
export const ADMIN_SCOPE = 'admin'

export const ADMIN_PASSCODE_KEY = 'failure_notes_admin_passcode_hash'
