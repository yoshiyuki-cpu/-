-- やること（タスク管理）。
-- 現場に紐づく作業（マニフェスト提出・近隣挨拶など）と、現場に紐づかない事務作業の
-- どちらも扱えるよう、project_id は任意にしている。
create table if not exists tasks (
  id serial primary key,
  title text not null,
  note text,
  -- 現場を消してもやること自体は残す（事務作業として残る場合があるため）
  project_id integer references projects(id) on delete set null,
  -- 担当者・達成者。作業員を消しても「誰がやったか」の記録は消さない
  assignee_id integer references workers(id) on delete set null,
  due_date date,
  done_at timestamptz,
  done_by integer references workers(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 未完了だけを期限順に引くのが主な使い方なので、その並びを速くする
create index if not exists tasks_done_at_idx on tasks (done_at);
create index if not exists tasks_due_date_idx on tasks (due_date);
