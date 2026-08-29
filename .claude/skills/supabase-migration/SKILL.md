---
name: supabase-migration
description: 3つのアプリ（焼肉がみや・株式会社良心・ラウンジケリー）でSupabaseのテーブルや列を追加・変更するときの共通ルール。新しいデータを保存できるようにする、項目を増やす、区分を足す、といった変更で必ず読むこと。SQLファイルの置き方と命名、何度実行しても壊れない書き方、記録を消さないための制約の選び方、そして「オーナーがまだSupabaseでSQLを実行していない状態でもアプリが落ちない」書き方、実行のお願いの伝え方を扱う。
---

# DB変更の共通ルール

3つのアプリのDBはすべて Supabase で、**SQLはオーナーが手でSupabaseのSQL Editorに貼って実行する**。
つまりコードを出した瞬間はまだDBが変わっていない。この時間差が事故の元なので、ここを最優先で守る。

## 1. ファイルの置き方

リポジトリ直下に**新しいファイルを作る**。既存のSQLファイルは書き換えない
（実行済みかどうか分からなくなる）。名前はそのリポジトリの既存の流儀に合わせる:

| リポジトリ | 命名 |
|---|---|
| 株式会社良心（`-`） | `supabase-schema-<機能名>.sql` |
| 焼肉がみや（`-gamiya`） | `supabase-migration-<機能名>.sql` |
| ラウンジケリー（`lounge-kelly`） | `supabase-schema-<機能名>.sql` |

## 2. 何度実行しても壊れない書き方

オーナーが二度実行することも、実行を忘れて後から実行することもある。

```sql
-- なぜこの形にしたのかを日本語で書く。読むのは半年後の自分か次のClaude。
create table if not exists <table> (
  id serial primary key,
  -- 親を消しても記録は残したいので set null（cascade にしない）
  project_id integer references projects(id) on delete set null,
  created_at timestamptz default now()
);

alter table <table> add column if not exists <col> <type>;
create index if not exists <table>_<col>_idx on <table> (<col>);
```

区分（種類）を増やすときは制約を貼り替える:

```sql
alter table other_entries drop constraint if exists other_entries_entry_type_check;
alter table other_entries add constraint other_entries_entry_type_check
  check (entry_type in ('labor', 'fuel', 'lease', 'expense'));
```

## 3. 記録を消すSQLは書かない

`drop table` / `truncate` / `delete` は書かない。Supabaseの無料プランには自動バックアップが無く、
消えた台帳（売上・人工・伝票・写真）は戻らない。

- 使わなくなった人・現場・商品は**削除ではなく印で隠す**（`deleted_at`、`in_dispatch`、`active`）
- 参照は原則 `on delete set null`。`cascade` は子データごと消える
- 機能を廃止するとき（がみやの仕込みタイマー等）も、まず画面から外すだけにして、
  テーブルの削除はオーナーに確認してから

## 4. いちばん大事: 実行前でもアプリが落ちない書き方

**追加したばかりの列で、DB側の絞り込みや並べ替えをしない。**
列が無い状態でその条件を投げると Postgres が `42703` でクエリごと失敗し、
一覧が丸ごと空になる。良心では実際にこれで現場一覧・段取り・マスタ・利用状況が同時に落ちた。

```ts
// ✕ SQL未実行の環境で全部落ちる
supabase.from('projects').select('*').is('deleted_at', null)

// ○ 全部取ってからJS側で振り分ける。列が無ければ undefined になるだけ
const { data } = await supabase.from('projects').select('*').order('name')
setProjects((data ?? []).filter(p => p.status === 'active' && !p.deleted_at))
```

書き込み（insert / update）は列が無ければ必ず失敗する。原因が分かる日本語を出す:

```ts
if (error) {
  setMessage(error.message.includes('deleted_at')
    ? 'ごみ箱の準備がまだです。SupabaseでSQLを実行してください。'
    : '保存できませんでした。')
}
```

この配慮が要るのは**今回追加した列だけ**。前から動いている列は普通にDB側で絞ってよい。

## 5. 実行のお願いの伝え方

SQLを新規作成したら、返事の最後に必ず、この3点を書く:

1. **ファイル名**（例: `supabase-schema-tasks.sql`）
2. **やること**（Supabaseの SQL Editor に中身を貼って実行）
3. **実行するまでどうなるか**（新機能だけが使えない／既存のデータは何も消えない）

実行を忘れると、オーナーからは「新機能が動かない」ではなく「アプリが壊れた」ように見える。
ここを毎回書くだけで、その勘違いが起きなくなる。

## 6. 型とコードの側

`lib/supabase.ts` に `export type` を足し、null が入りうる列は `| null` を付ける。
画面の作り方はリポジトリごとのスキル（良心なら `add-feature` / `ui-style`）を見ること。
