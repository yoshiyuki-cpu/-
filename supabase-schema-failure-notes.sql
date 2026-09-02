-- 振り返り（今月の失敗の記録）。職長が自分の失敗を書き、本人と管理者だけが読む。
--
-- 見えなくする仕組みは「画面に合言葉をかける」までにしている（オーナー判断）。
-- このアプリには利用者ごとのログインが無く、Supabaseの鍵はアプリに埋め込まれているため、
-- DBを直接見られる相手には本文が読める。本当に読めなくするなら本文の暗号化が必要。
-- そのため、書く人に過度な期待を持たせないよう、画面にもその旨を出している。
--
-- 合言葉そのものは平文で置かない。SHA-256のハッシュだけを持つ（使い回しの被害を避けるため）。
create table if not exists failure_notes (
  id serial primary key,
  -- 誰が書いたか。作業員を消しても記録は残す
  worker_id integer references workers(id) on delete set null,
  -- 'YYYY-MM'。月ごとの振り返りとして扱う
  month text not null,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 本人の分を月ごとに引くのが主な使い方
create index if not exists failure_notes_worker_month_idx on failure_notes (worker_id, month);

-- 職長ごとの合言葉（ハッシュ）。未設定なら、その職長が初回に自分で決める
alter table workers add column if not exists note_passcode_hash text;

-- 管理者の合言葉など、アプリ全体の設定を置く場所。今後の設定もここに足せる
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
