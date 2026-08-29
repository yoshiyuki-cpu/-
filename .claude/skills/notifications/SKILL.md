---
name: notifications
description: 良心アプリの通知まわり（LINE・メール・スマホのプッシュ通知）と、決まった時刻に自動で走らせる処理（Vercel cron）を追加・変更するときの手順。「◯時に自動で知らせて」「職長にLINEで送りたい」「リマインダーの文面を変えて」「通知が届かない」「毎朝／毎晩◯◯する」といった依頼のときは必ず読むこと。lib/notify.ts の送信部品、送り先の絞り方、UTCと日本時間の時差、二重送信の防ぎ方、通知が失敗しても止まらない書き方を扱う。
---

# 通知・自動実行の手順

通知は現場の人のスマホに直接届く。間違えると「夜中に鳴る」「毎日二重で届く」「誰にも届かない」の
どれかになり、どれも信用を失う。時刻と送り先と重複を、コードを書く前に確定させること。

## 部品はすべて lib/notify.ts にある

新しく送信処理を書き起こさず、次を使う:

| 用途 | 関数 |
|---|---|
| メール（Gmail） | `sendReminderEmail(to, subject, bodyLines)` |
| スマホのプッシュ | `sendReminderPush(supabase, workerId, title, body, url)` |
| LINE | `sendLineMessage(lineUserId, text)` |
| 画面へのリンク | `projectUrl(path, projectId)` |
| 日曜判定（JST） | `isJstSunday(now?)` |
| 職長＋担当現場の取得 | `fetchForemanTargets(supabase)` |
| 広報担当の取得 | `fetchPrTargets(supabase)` |

送り先は `workers` の印で決まる（`is_foreman` / `is_google_ads` / `is_x_pr` / `in_dispatch`）。
新しい送り先の区分が要るときは列を足すことになるので `add-feature` スキルも合わせて読むこと。

文面の組み立ては送信と分け、`build...Lines()` のような純粋な関数にする
（`lib/dispatchNotify.ts` の `buildDispatchLines` が見本）。画面の「通知する」ボタンと
自動送信の両方から同じ文面を使い回せて、プレビュー表示もできる。

## 時刻は必ずUTCで書く

Vercel の cron（`vercel.json`）も、サーバー上の `new Date()` も UTC。日本時間から9時間引く。

- 朝7:50 JST → `"50 22 * * *"`（前日の22:50 UTC）
- 夕方17:30 JST → `"30 8 * * *"`
- 18:30 JST → `"30 9 * * *"`

日付をまたぐ向きを間違えると1日ずれる。JSTの日付が要る処理では、`lib/notify.ts` や
`app/api/cron/dispatch-reminder/route.ts` のように `Asia/Tokyo` 指定の `Intl.DateTimeFormat`
か +9時間して計算する。

cron の本数には契約プランの上限があり、既存も1本にまとめて回している
（`app/api/cron/morning-reminder/route.ts` の冒頭コメント参照）。新しい定時処理は、まず
既存の朝／夕の便に相乗りできないか検討し、増やすときはユーザーに上限を確認する。

## cron ルートの型

`app/api/cron/<名前>/route.ts` に置き、この骨格を守る:

```ts
export const maxDuration = 60   // 送信先が多いと既定の実行時間では足りない

// CRON_SECRETが設定されている環境だけ検証する（未設定のプレビュー環境でも動かせるように）
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  ...
  return NextResponse.json({ ok: true, ... })
}
```

`vercel.json` の `crons` への追加を忘れない。ファイルを置いただけでは走らない。

## 送らない条件を先に書く

現場を止めないために、既存の便は「送らない判断」を明示している。新しい通知でも同じように考える:

- 日曜・休みの日は送らない → `isJstSunday()`
- 中身が空のときは送らない（配員ゼロの段取り表など）
- 手動送信済みなら自動では送らない → `dispatch_plans.notified_at` を見る。内容を編集したら
  画面側でこの印を消し、変更があった日は改めて送られるようにする

## 失敗しても全体を止めない

1人分の送信が失敗しても他の人には届くように、送信は個別に握りつぶして `console.error` で
理由を残し、レスポンスには `{ ok: true, skipped: '...' }` のように結果を返す。
cron が例外で落ちると、次の実行まで誰にも何も届かない。

## 動作確認

マスタ画面に職長への「テスト送信」ボタン（`/api/notify-test`）がある。文面を変えたら、
自動送信を待たずにこれで実物を見てもらう。LINEは `line_user_id` が入っている人にしか
届かない（未連携の人はメール／プッシュのみ）ので、届かない報告があればまずそこを確認する。
