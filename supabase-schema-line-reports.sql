-- LINE からの報告。グループ LINE に書かれた「福田 今日 西谷と山田 1日ずつ、木屑 3t」のような
-- 文章を受け取り、AI が現場・人工・廃材・経費に読み分けて台帳に入れる。
--
-- 元の文章と読み取り結果をここに残し、台帳側の行には line_report_id を付ける。
-- 「取消」と返信されたら line_report_id で行を探して消せる。報告を消しても台帳の行は残す
-- （on delete set null）。
create table if not exists line_reports (
  id serial primary key,
  received_at timestamptz default now(),
  -- LINE の再送で同じ出来事が2回来ても2回登録しないための印
  line_event_id text unique,
  line_group_id text,                 -- グループの ID。1対1のトークなら null
  line_user_id text,                  -- 送った人の LINE ID
  worker_id integer references workers(id) on delete set null,  -- 送った人が連携済みなら
  text text,
  parsed jsonb,                       -- AI の読み取り結果（現場・人工・廃材・経費）
  -- pending: 現場が分からず確認待ち / registered: 台帳に入れた / cancelled: 取消した
  -- rejected: アプリで却下した / ignored: 報告ではない（雑談など）
  status text not null default 'pending',
  project_id integer references projects(id) on delete set null,
  registered_at timestamptz,
  note text
);
create index if not exists line_reports_status_idx on line_reports (status, received_at desc);

-- 台帳側に「どの LINE 報告から入ったか」を持たせる。取消のときに使う
alter table labor_entries add column if not exists line_report_id integer references line_reports(id) on delete set null;
alter table waste_entries add column if not exists line_report_id integer references line_reports(id) on delete set null;
alter table other_entries add column if not exists line_report_id integer references line_reports(id) on delete set null;
