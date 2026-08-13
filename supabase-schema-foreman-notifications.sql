-- 職長への朝夕リマインダー通知（メール・プッシュ通知）用
alter table workers add column if not exists email text;
alter table workers add column if not exists is_foreman boolean not null default false;

-- 職長（workers）と担当現場（projects）の割り当て（1人が複数現場を担当できる）
create table if not exists foreman_projects (
  worker_id integer references workers(id) on delete cascade,
  project_id integer references projects(id) on delete cascade,
  primary key (worker_id, project_id)
);

-- ブラウザのプッシュ通知購読情報（職長の端末ごとに1件）
create table if not exists push_subscriptions (
  id serial primary key,
  worker_id integer references workers(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
