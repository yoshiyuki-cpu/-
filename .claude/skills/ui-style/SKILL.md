---
name: ui-style
description: 良心アプリの画面を作る・直すときの見た目と日本語の決まりごと。新しいページやフォーム、一覧、ボタン、モーダル、タブを足すとき、あるいは「見た目を整えて」「他の画面と揃えて」「使いにくい」と言われたときは必ず読むこと。スマホ前提のレイアウト、カード・入力欄・ボタンのクラス、色の使い分け、金額と日付の見せ方、現場の人に伝わる日本語の言い回しを扱う。
---

# 画面の作り方（見た目と言葉）

使うのは現場の人。多くは屋外で、手袋か汚れた手で、片手でスマホを触っている。
**押しやすさと、読めば分かる日本語**が最優先。凝った装飾はいらない。

## 土台

`app/layout.tsx` が全ページ共通の枠を持っている。個別ページで作り直さない。

- ヘッダー（紺→青のグラデーション）と下の `BottomNav` は共通
- 本文は `max-w-2xl mx-auto px-4 py-6 pb-28`。`pb-28` は下の帯に隠れないための余白
- 背景 `#f4f6fa` の上に**白いカードを置く**のが基本。ページ全体に白を敷かない
- 金額は等幅数字（`font-variant-numeric: tabular-nums`）が効いているので、桁を揃えるための
  細工は不要。表示は `Number(n).toLocaleString()` で3桁区切りにし、単位「円」を添える
- 印刷に出したくない要素には `no-print` を付ける（見積の印刷画面がある）

## そのまま使うクラス

```
カード      bg-white rounded-2xl border border-gray-100 shadow-sm p-4
入力・選択  w-full border border-gray-200 rounded-lg px-3 py-2 text-sm   （selectは + bg-white）
主ボタン    bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40
副ボタン    bg-white text-gray-600 border border-gray-200 rounded-lg text-sm
タブ        flex-1 py-2 rounded-full text-sm font-medium transition
            （選択中: bg-blue-600 text-white shadow-sm ／ 非選択: bg-white text-gray-500 border border-gray-200）
見出し      text-xl font-bold （節見出しは font-bold text-sm text-gray-700）
補足説明    text-xs text-gray-500
```

色は意味で決める。青＝操作・選択中、赤＝遅れ／削除、オレンジ＝今日、黄＝もうすぐ、
グレー＝補足。装飾目的で色を増やさない（`app/tasks/page.tsx` の `DUE_TONE` が使い分けの見本）。

タップする要素は指で押せる大きさに。丸ボタンは `w-7 h-7` 以上、リストの行は `py-2.5` 以上。

## 画面の骨格

```
見出し（h1）＋ 一行の説明（この画面で何ができるか）
↓ 追加・入力欄（思いついてすぐ入れられるよう上に置く）
↓ タブや絞り込み
↓ 一覧（カードを flex flex-col gap-2 で縦に並べる）
```

- 読み込み中: `<p className="text-center py-10 text-gray-500">読み込み中...</p>`
- 空のとき: グレーの文で「まだ◯◯がありません。」と、次にすることを一言
- 消す操作は `confirm('この作業員を削除しますか？')` で一度止める
- エラーや完了は `alert` を乱発せず、画面内の `message` として日本語で出す

## 日本語

- 現場で使われている言葉に合わせる: 現場、段取り、出面、人工、やる事、職長、応援先
- 専門用語やシステム用語（レコード、エラー、同期、バリデーション）は画面に出さない
- 失敗のお知らせは、原因ではなく**次にすること**を書く
  - ✕「保存に失敗しました（42703）」
  - ○「ごみ箱の準備がまだです。SupabaseでSQLを実行してください。」
- 日付は `8/29(土)` の形（曜日つき）。期限は「あと2日」「3日遅れ」のように、残りで見せると現場で判断が速い
  （`dueLabel` を参考に）
- 説明文は敬体で短く。「丸を押して自分の名前を選ぶと達成になり、誰がやったかが記録に残ります。」くらいの粒度

## 迷ったら

新しい見た目を発明せず、いちばん近い既存画面を開いて真似する。素直な見本は
`app/tasks/page.tsx`（一覧＋タブ＋モーダル）、`app/master/page.tsx`（設定・その場編集）、
`app/dispatch/page.tsx`（割り当て操作）。
