-- 足場計算: 単管の規格長に6mを追加
-- 詳細設計は docs/scaffold-spec.md 参照
insert into scaffold_material_prices (category, label, sort_order) values
  ('pipe', '6', -1)
on conflict (category, label) do nothing;
