-- 朝の KY活動・議事録の徹底と、夕方の記入状況の報告（2026-09 社長の指示）。
--
-- 1) その日のその現場の KY活動（写真）と議事録が両方登録されるまで、人工・処分代（廃材）を
--    入力できないようにする。判定は既存の ky_photos / meeting_notes を見るだけなので表は増やさない。
--    社長が合言葉で解除した記録と、社長の LINE の連携先は既存の app_settings に入れる。
-- 2) 毎日19:30に、現場ごとの記入状況を社長と「受け取る人」に印を付けた作業員（難波君）にだけ送る。
--
-- 何度実行しても壊れない。記録は消さない。

-- 夕方の記入状況の報告を受け取る人の印
alter table workers add column if not exists receives_entry_report boolean not null default false;

-- 難波君に印を付ける。先に対象を確かめたいときは次の1行だけ実行する：
--   select id, name from workers where name like '%難波%';
update workers set receives_entry_report = true where name like '%難波%';

-- 入力画面を開くたびに「今日のKY・議事録があるか」を引くので、引きやすくしておく
create index if not exists ky_photos_project_date_idx on ky_photos (project_id, date);
create index if not exists meeting_notes_project_date_idx on meeting_notes (project_id, date);
