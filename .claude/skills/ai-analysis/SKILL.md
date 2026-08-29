---
name: ai-analysis
description: 良心アプリで写真・音声・記録をAI（Claude）に読ませる機能を追加・修正するときの手順。「レシートの写真から金額を読み取りたい」「音声で入力したい」「議事録をAIでまとめて」「AI分析がうまくいかない・変な結果になる」といった依頼のとき必ず読むこと。app/api/analyze-* のAPIルートの型、使うモデル、JSONで返させるプロンプトの書き方、読み取れなかったときも手入力で進められるようにする作りを扱う。
---

# AI解析機能の手順

この手の機能の値打ちは「現場で入力の手間が減ること」だけにある。**読み取れなくても手で入力して
先に進めること**が絶対条件で、AIが賢いことは二の次。ここを外すと、写真を撮ったのに保存できない
という一番困る状態になる。

## APIルートの型

`app/api/analyze-<対象>/route.ts` を新規作成し、既存（`analyze-receipt` / `analyze-scrap` /
`analyze-expense` / `analyze-minutes` / `analyze-voice-minutes`）と同じ骨格に揃える:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: '（日本語の指示。JSONの形をそのまま書く）' },
    ] }],
  })

  // モデルが ```json で囲って返すことがあるので剥がす。壊れたJSONでも
  // 画面が落ちないよう、空の同じ形を返して手入力に切り替えてもらう
  try {
    const text = (message.content[0] as any).text.trim()
    return NextResponse.json(JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()))
  } catch {
    return NextResponse.json({ amount: null })
  }
}
```

- モデルは伝票の読み取り・文字起こしの整形程度なら `claude-haiku-4-5-20251001`（既存すべてこれ）。
  速さと費用が現場の使い勝手に直結する。**モデルIDや料金・APIの使い方を調べ直すときは
  `claude-api` スキルを読むこと**。記憶で書かない。
- `ANTHROPIC_API_KEY` はサーバー側の環境変数。ブラウザから直接 Anthropic を呼ばない
  （鍵が漏れる）ので、必ずAPIルートを挟む。
- `max_tokens` は返させるJSONに見合う小さめの値にする。
- 分析に時間がかかるもの（利用状況の分析など）は `export const maxDuration = 30` を付ける。

## プロンプトの書き方

日本語で、**返してほしいJSONの形をそのまま書いて「JSONのみ返してください」で締める**のが
このアプリの流儀。読み取れない項目は `null` と明示しておくと、画面側で「読み取れませんでした」に
分岐できる。

例（`analyze-scrap`）:

> これはスクラップ業者の伝票です。以下の情報をJSON形式で抽出してください。
> `{"items": [{"name": "品目名", "amount": 金額の数値}], "total": 合計金額の数値}`。
> 品目が複数ある場合はすべて含めてください。金額が読み取れない場合はnullにしてください。JSONのみ返してください。

音声の文字起こしを扱うときは「音声認識特有の誤変換を文脈から直したうえで」と足す
（現場の固有名詞や専門用語がよく崩れるため）。

## 画面側

- 写真は送る前に必ず縮小する。`app/projects/[id]/entry/page.tsx` の `resizeImageToBase64`
  （長辺1600px・JPEG品質0.7）と同じやり方。現場のスマホ写真をそのまま送ると、通信が細い
  場所で待たされるか失敗する。
- 呼び出しは `fetch('/api/analyze-...', { method: 'POST', ... })`。`res.ok` を確認し、
  `try/catch` で囲む。
- 結果は**フォームに差し込むだけ**にして、保存はユーザーが確認して押す。AIの結果を
  そのままDBに書かない（金額を間違えると台帳が狂う）。
- 失敗時・読み取れなかったときは、その場に日本語で出す:
  「読み取りに失敗しました。金額を直接入力してください。」のように、次にすることまで書く。
- 実行中は `setSaving(true)` などでボタンを止め、二度押しで二重に課金・二重に入力されないようにする。
