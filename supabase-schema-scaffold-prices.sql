-- 足場計算 Phase 3: 資材単価マスタ
-- 詳細設計は docs/scaffold-spec.md 参照
-- 単管は長さ別（4/3/2/1m）、用途別部材（筋交い等）は自由に追加できる想定
create table scaffold_material_prices (
  id serial primary key,
  category text not null check (category in ('pipe', 'usage')),
  label text not null,
  unit_price numeric(10,2),
  sort_order integer not null default 0,
  created_at timestamptz default now()
);
create unique index scaffold_material_prices_category_label_idx on scaffold_material_prices(category, label);

insert into scaffold_material_prices (category, label, sort_order) values
  ('pipe', '4', 0),
  ('pipe', '3', 1),
  ('pipe', '2', 2),
  ('pipe', '1', 3),
  ('usage', '筋交い', 0),
  ('usage', '手すり', 1),
  ('usage', '幅木', 2),
  ('usage', 'ジョイント', 3),
  ('usage', 'ベース金具', 4);
