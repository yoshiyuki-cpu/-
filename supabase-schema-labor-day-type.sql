-- 半日出勤対応: labor_entriesに全日/半日の区分を追加
alter table labor_entries
  add column if not exists day_type text not null default 'full' check (day_type in ('full', 'half'));
