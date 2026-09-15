-- 現場ごとに「その日の朝一チェック」が済んでいるかを記録する。
-- 議事録の危険箇所・注意事項・伝達事項を確認しないとその現場の詳細を開けない仕様にするため。
-- 確認した人は project_checks と同じ形（作業員IDが分かれば残し、社長など作業員表に
-- 居ない場合は名前だけ残す）で保存する。現場×日付で1回チェックされれば全員分OKとする。
create table morning_checks (
  id serial primary key,
  project_id integer references projects(id) on delete cascade,
  check_date date not null,
  checked_by_id integer references workers(id) on delete set null,
  checked_by_name text,
  checked_at timestamptz default now(),
  unique (project_id, check_date)
);
