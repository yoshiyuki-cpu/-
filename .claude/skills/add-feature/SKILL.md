---
name: add-feature
description: 良心アプリ（このリポジトリ）に新しい機能を足すときの手順。新しいデータを保存できるようにする、新しい画面を作る、既存の入力項目を増やす、といった変更のとき必ず読むこと。Supabaseのテーブル・列の追加SQL、lib/supabase.ts の型、画面の作り方、BottomNavへの登録、そして「本番のSupabaseでSQLをまだ実行していない状態でも画面が壊れない」書き方までを扱う。「〜を記録できるようにして」「〜を管理したい」「〜の項目を増やして」「マスタに〜を追加」など、データや画面が増える依頼はすべてこのスキルの対象。
---

# 機能追加の手順

このアプリは足場・解体の現場で毎日使われている。壊れると当日の段取りや台帳が止まるので、
「動かす」ことより「既にある記録を壊さない」ことを優先して作る。

## 全体の流れ

1. 何をどこに保存するか決める（新しいテーブルか、既存テーブルの列追加か）
2. `supabase-schema-<機能名>.sql` を新規作成する
3. `lib/supabase.ts` に型を足す
4. 画面（`app/.../page.tsx`）を作る・直す
5. 必要なら `app/BottomNav.tsx` に導線を足す
6. `npm run lint` を通す
7. ユーザーに「Supabaseでこの SQL を実行してください」と、ファイル名を添えて必ず伝える

## 1〜2. SQLファイル

リポジトリ直下に `supabase-schema-<機能名>.sql` を新規で作る（既存ファイルは書き換えない。
実行済みかどうかが分からなくなるため）。中身は何度実行しても壊れない形にする。

```sql
-- なぜこの形にしたのかを日本語で書く。半年後に読むのは現場の人ではなく次のClaude。
create table if not exists <table> (
  id serial primary key,
  -- 現場を消しても記録は残したいので set null（cascade にしない）
  project_id integer references projects(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists <table>_<col>_idx on <table> (<col>);
```

列追加は `alter table <table> add column if not exists <col> <type>;`。

守ること:

- **既存の行を消す・作り直すSQLは書かない。** `drop table` / `truncate` / `delete` は台帳が消える。
  制約の貼り替えが必要なときだけ `drop constraint if exists` → `add constraint` を使う
  （例: `supabase-schema-expense-type.sql`）。
- 作業員（workers）や現場（projects）は「使わなくなっても消せない」。過去の人工記録が
  紐づいているため。使わなくする機能は、削除ではなく印（`in_dispatch`、`deleted_at` など）で隠す。
- 参照は原則 `on delete set null`。`cascade` は子データごと消えて戻せない。

## 3. 型

`lib/supabase.ts` に `export type` を足す。DBに合わせて、null が入りうる列は `| null` を付ける。
画面側は `import { supabase, Task } from '@/lib/supabase'` の形で使う。

## 4. 画面

- 先頭に `'use client'`。データ取得はサーバーを挟まず `supabase` を直接呼ぶのが全画面共通のやり方。
- 読み込みは `load()` にまとめ、`Promise.all` で並べて引く（`app/tasks/page.tsx` が素直な見本）。
- 見た目・日本語の言い回しは `ui-style` スキルに従う。

### いちばん大事な注意: 新しい列で DB 側の絞り込みをしない

本番の Supabase は、ユーザーが手で SQL を実行して初めてその列を持つ。実行前に
`.is('deleted_at', null)` のような条件を投げると、Postgres が 42703 で **クエリごと失敗し、
一覧が丸ごと空になる**（実際に #30 で現場一覧・段取り・マスタ・利用状況が同時に落ちた）。

そこで、追加したばかりの列は「全部取ってからJS側で振り分ける」:

```ts
const { data: pj } = await supabase.from('projects').select('*').order('name')
// 列が無い環境では undefined になるだけなので、一覧はそのまま出る
const all = pj ?? []
setProjects(all.filter(p => p.status === 'active' && !p.deleted_at))
```

書き込み側（update/insert）は列が無いと必ず失敗する。その場合は原因が分かる日本語を出す:

```ts
if (error) {
  setMessage(error.message.includes('deleted_at')
    ? 'ごみ箱の準備がまだです。SupabaseでSQLを実行してください。'
    : 'ごみ箱に入れられませんでした。')
  return
}
```

この配慮が要るのは「今回追加した列」だけ。前から動いている列は普通に DB 側で絞ってよい。

## 5. BottomNav

下の帯は現状8個で幅がいっぱい。主要画面を新設したときだけ `NAV_ITEMS` に足し、
現場の中の画面（`/projects/[id]/...`）は現場詳細から辿らせる。

## 6〜7. 仕上げ

- `npm run lint`（`node_modules` が無ければ先に `npm install`）。`npm run build` は
  Supabase の環境変数が要るので、手元で通らなくても異常ではない。
- コミットメッセージは履歴に合わせて日本語一行、「〜できるようにした」「〜を追加」の形。
  なぜ必要だったかを本文に数行添える。
- **SQLを新規作成したら、返事の最後に必ず実行のお願いを書く。** 実行を忘れると、
  ユーザーからは「新機能が動かない」ではなく「アプリが壊れた」ように見える。
