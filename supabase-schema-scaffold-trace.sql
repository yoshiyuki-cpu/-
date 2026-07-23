-- 足場計算 Phase 2: 図面トレース入力（上空図面/図面画像上で建物輪郭をなぞって拾い出す）
-- 詳細設計は docs/scaffold-spec.md 参照

alter table scaffold_plans
  drop constraint if exists scaffold_plans_input_mode_check;
alter table scaffold_plans
  add constraint scaffold_plans_input_mode_check check (input_mode in ('directions', 'rect', 'perimeter', 'trace'));

alter table scaffold_plans
  add column if not exists image_url text,
  add column if not exists scale_m_per_px numeric(12,6);

-- 頂点座標（trace モードのみ使用。画像の元サイズ基準のpx座標）
alter table scaffold_segments
  add column if not exists vertex_x_px numeric(10,2),
  add column if not exists vertex_y_px numeric(10,2);
