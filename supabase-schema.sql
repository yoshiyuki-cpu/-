-- 処分場マスタ
create table disposal_sites (
  id serial primary key,
  name text not null,
  created_at timestamptz default now()
);

-- 廃材種類マスタ
create table waste_types (
  id serial primary key,
  disposal_site_id integer references disposal_sites(id) on delete cascade,
  name text not null,
  unit text not null default 'kg',
  unit_price numeric(10,2) not null default 0,
  entry_type text not null default 'cost' check (entry_type in ('cost', 'revenue')),
  created_at timestamptz default now()
);

-- 現場マスタ
create table projects (
  id serial primary key,
  name text not null,
  location text not null default '',
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz default now()
);

-- 廃材記録
create table waste_entries (
  id serial primary key,
  project_id integer references projects(id) on delete cascade,
  waste_type_id integer references waste_types(id),
  date date not null,
  quantity numeric(10,3) not null,
  amount numeric(12,0) not null,
  created_at timestamptz default now()
);

-- その他費用記録（人工数・燃料代・リース代）
create table other_entries (
  id serial primary key,
  project_id integer references projects(id) on delete cascade,
  entry_type text not null check (entry_type in ('labor', 'fuel', 'lease')),
  date date not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,0) not null default 0,
  amount numeric(12,0) not null,
  note text,
  created_at timestamptz default now()
);

-- サンプルデータ（処分場）
insert into disposal_sites (name) values
  ('タマタイ'),
  ('マテリアル'),
  ('インテックス'),
  ('南備'),
  ('藤クリーン'),
  ('新生建材'),
  ('第一建設'),
  ('クレスト'),
  ('ミゾグチ'),
  ('事業団'),
  ('宝来');

-- サンプルデータ（タマタイの廃材種類）
insert into waste_types (disposal_site_id, name, unit, unit_price, entry_type) values
  (1, '廃材', 'kg', 12, 'cost'),
  (1, '枝葉', 'kg', 12, 'cost'),
  (1, '根', 'kg', 13, 'cost'),
  (1, '土壁', '㎥', 5000, 'cost');

-- サンプルデータ（マテリアルの廃材種類）
insert into waste_types (disposal_site_id, name, unit, unit_price, entry_type) values
  (2, '木屑A', 'kg', 11, 'cost'),
  (2, '柱A', 'kg', 9, 'cost');

-- サンプルデータ（インテックスの廃材種類）
insert into waste_types (disposal_site_id, name, unit, unit_price, entry_type) values
  (3, '廃プラ A', 'kg', 50, 'cost'),
  (3, '廃プラ B', 'kg', 55, 'cost'),
  (3, '廃プラ 混合', 'kg', 55, 'cost'),
  (3, '木くず', 'kg', 20, 'cost'),
  (3, '木くずB', 'kg', 25, 'cost'),
  (3, '石膏ボード', 'kg', 20, 'cost'),
  (3, 'ベッドマット', '枚', 3000, 'cost'),
  (3, 'ソファ', 'kg', 100, 'cost'),
  (3, 'ガラス', 'kg', 20, 'cost');
