---
name: line-notify
description: 3つのアプリ（焼肉がみや・株式会社良心・ラウンジケリー）でLINEに通知を送る機能を追加・変更するときの共通ルール。「LINEで知らせたい」「◯時にリマインドして」「通知が届かない」「通知が多すぎる／二重に来る」といった依頼のときは必ず読むこと。無料通数の枠の守り方、全員に送る(broadcast)と個人に送る(push)の使い分け、Vercel cronとJSTの時差、営業日の区切り、送らない条件の決め方、通知文の型を扱う。
---

# LINE通知の共通ルール

LINEは相手のスマホが鳴る。**鳴らしすぎると読まれなくなり、鳴らなすぎると仕組みが止まる。**
機能そのものより、「誰に・いつ・何通まで」を先に決めることの方が大事。

## 送る前に決める4つ

1. **本当にLINEが要るか。** アプリを毎日開く人（店長・職長）ならアプリ内の表示で足りることがある
2. **全員か個人か。** 全員に同じ文面 → broadcast（がみや）。人によって内容が違う → push（良心の職長便）
3. **送らない条件。** 済んでいる日・空の日・休みの日は送らない。ここを先に書く
4. **優先度。** 枠が減ったとき、どの通知から落とすか

## 無料通数は有限。設計に織り込む

LINE公式アカウントは月あたりの無料通数に上限があり、**送信通数は宛先の人数分だけ減る**。
がみやではこれを `lib/lineNotify.ts` の `KEEP_REMAINING` で扱っている。この型を他店でも使う:

```ts
// 通知ごとの「ここまで減ったらもう送らない」通数。
// 枠が尽きかけたとき、数字の大きい通知から順に落ちていく。
export const KEEP_REMAINING = {
  reportCheck: 0,        // 毎日の義務。枠がある限り最後まで送る
  shiftReminder: 6,      // 締め切りに間に合わないと組めない
  xPost: 15,
  tomorrowReservations: 30,
}
```

残数は LINE の quota / consumption API で取れる（`remainingMessages`）。ただし
**残数が確認できなかったことを理由に送信を止めない**。届かない方が困る。

節約でいちばん効くのは通数の削減ではなく**送り先の削減**。良心の `in_dispatch`、
職長だけに送る `is_foreman` のように、送る相手を印で絞る。

## 時刻と営業日

- Vercel cron（`vercel.json`）もサーバーの `new Date()` も **UTC**。日本時間から9時間引く
  - 朝7:50 JST → `"50 22 * * *"` ／ 17:30 JST → `"30 8 * * *"` ／ 18:30 JST → `"30 9 * * *"`
- **営業日の区切りは店ごとに違う。** がみやは朝5時区切り（`jstBusinessDayKey`）、良心は暦日、
  ケリーは深夜0時をまたぐので端末のローカル日付（`lib/localDate.ts`）。
  日付キーは必ず関数にして、画面とサーバーで同じ答えになるようにする
- 休みの日は送らない（良心は日曜スキップ `isJstSunday`）
- cron の本数はプランの上限がある。増やす前に、既存の便に相乗りできないか考える

## APIルートの骨格

```ts
export const dynamic = 'force-dynamic'   // 毎回実行させる

export async function GET(req: NextRequest) {
  const rejected = rejectIfNotCron(req)      // CRON_SECRET が設定されていれば検証
  if (rejected) return rejected

  const key = jstBusinessDayKey()            // 店の営業日の区切りで日付を出す
  if (すでに済んでいる) return NextResponse.json({ notified: false, reason: 'already' })
  if (中身が空) return NextResponse.json({ notified: false, reason: 'empty' })

  const result = await broadcastLine(text, { keepRemaining: KEEP_REMAINING.xxx })
  return NextResponse.json({ notified: result.sent })
}
```

- `vercel.json` の `crons` への追加を忘れない。ファイルを置いただけでは走らない
- 1人分の送信失敗で全体を止めない。`console.error` に残し、レスポンスには結果を返す
- 手動送信のボタンがある機能（良心の段取り通知）は、自動送信と**同じ文面組み立て関数**を使い、
  手動で送った日は自動では送らない（`notified_at` の印を見る）

## 通知文の型

読むのは営業中・現場・深夜のスタッフ。**3秒で「自分が何をすればいいか」が分かること。**

```
📣 Xの投稿リマインドです

本日はまだ投稿が記録されていません。
17時30分前後の投稿をお願いします!

投稿できたら、アプリの「日報」画面で
「投稿した」を押してください。
https://…/reports
```

- 1行目で用件、次に期限、最後に**押す場所へのリンク**
- お願い口調。命令形にしない
- リンクは `appUrl()` / `projectUrl()` で作る（環境変数が無い環境でも落ちないように）

## 届かないと言われたら

1. その人のLINE連携（`line_user_id`）が入っているか。未連携ならメール・プッシュのみ
2. 無料枠が尽きていないか（残数API・`reason: 'quota'` のログ）
3. 「送らない条件」に引っかかっていないか（済み・空・休み）
4. cron が動いたか（Vercelの実行ログ）。`vercel.json` に入れ忘れていないか

良心リポジトリの部品の詳細は `notifications` スキルを見ること。
