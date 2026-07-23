-- 足場計算（現場紐付け版）。1現場につき1プランのみ（project_idにUNIQUE制約）
-- 詳細設計は docs/scaffold-spec.md 参照
create table scaffold_plans (
  id serial primary key,
  project_id integer not null references projects(id) on delete cascade unique,
  input_mode text not null default 'directions' check (input_mode in ('directions', 'rect', 'perimeter')),
  span_interval_m numeric(10,2) not null default 1.8,
  level_height_m numeric(10,2) not null default 1.8,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 辺（セグメント）。directions/rectモードは4行、perimeterモードは1行（全周分）を保存する
create table scaffold_segments (
  id serial primary key,
  plan_id integer not null references scaffold_plans(id) on delete cascade,
  order_index integer not null default 0,
  label text,
  length_m numeric(10,2) not null default 0,
  height_m numeric(10,2) not null default 0
);
