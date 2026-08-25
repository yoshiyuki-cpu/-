-- 翌日の段取り（配員）機能。
-- 昼過ぎから職長が話しながら何度も入れ替えるため、行き先（グループ）と配員を分けて持ち、
-- 入れ替えは dispatch_assignments.group_id の更新だけで済むようにしている。

-- 応援先（他社）マスタ。増減するのでマスタ管理から編集できるようにする
create table if not exists support_companies (
  id serial primary key,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

insert into support_companies (name, sort_order) values
  ('ベルジャパン', 1),
  ('Fライズ', 2),
  ('宝来', 3),
  ('Wing', 4)
on conflict do nothing;

-- 日ごとの段取り（1日1件）
create table if not exists dispatch_plans (
  id serial primary key,
  date date not null unique,
  notified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 行き先。自社現場なら project_id、応援なら support_company_id が入る。
-- 集合時間・集合場所は行き先ごとに決めるのでここに持たせる
create table if not exists dispatch_groups (
  id serial primary key,
  plan_id integer not null references dispatch_plans(id) on delete cascade,
  project_id integer references projects(id) on delete cascade,
  support_company_id integer references support_companies(id) on delete cascade,
  meet_time text,
  meet_place text,
  note text,
  created_at timestamptz default now(),
  check (
    (project_id is not null and support_company_id is null) or
    (project_id is null and support_company_id is not null)
  )
);

-- 同じ日に同じ行き先のグループが二重にできないようにする
create unique index if not exists dispatch_groups_plan_project_key
  on dispatch_groups (plan_id, project_id) where project_id is not null;
create unique index if not exists dispatch_groups_plan_support_key
  on dispatch_groups (plan_id, support_company_id) where support_company_id is not null;

-- 配員。1人が同じ日に2箇所へ行くことはないので (plan_id, worker_id) を一意にする。
-- 行き先の入れ替えは group_id を更新するだけでよい
create table if not exists dispatch_assignments (
  id serial primary key,
  plan_id integer not null references dispatch_plans(id) on delete cascade,
  group_id integer not null references dispatch_groups(id) on delete cascade,
  worker_id integer not null references workers(id) on delete cascade,
  created_at timestamptz default now(),
  unique (plan_id, worker_id)
);
