-- 現場ごとに「その日の朝一チェック」が済んでいるかを記録する
-- 議事録の危険箇所・注意事項・伝達事項を確認しないとその現場の詳細を開けない仕様にするため。
-- ログイン機能が無いアプリのため、現場×日付で1回チェックされれば全員分OKとして共有する。
create table morning_checks (
  id serial primary key,
  project_id integer references projects(id) on delete cascade,
  check_date date not null,
  checked_by text,
  checked_at timestamptz default now(),
  unique (project_id, check_date)
);
