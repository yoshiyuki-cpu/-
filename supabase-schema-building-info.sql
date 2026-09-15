-- 建物情報。現場（projects）に、壊す建物の基本情報を持たせる。
--
-- 解体の見積・段取り・届出（アスベストの事前調査など）で毎回聞かれる項目を、
-- 現場詳細で一度入れれば全員が見られるようにする。別テーブルにせず projects の列にしたのは
-- 1現場に1棟が基本で、現場詳細が既に projects を select('*') で読んでいるため
-- （列が無い環境でも読む側は壊れない。書く側だけ SQL 実行前は失敗し、画面で案内する）。
alter table projects add column if not exists building_structure text;      -- 構造（木造・鉄骨造・RC造・SRC造・混構造・その他）
alter table projects add column if not exists building_floors integer;      -- 階数（地上）
alter table projects add column if not exists building_floor_area numeric(10,2); -- 延床面積（㎡）
alter table projects add column if not exists building_built_year integer;  -- 建築年（西暦）。築年数は画面で計算する
alter table projects add column if not exists building_usage text;          -- 用途（住宅・アパート・店舗・倉庫など）
alter table projects add column if not exists building_asbestos text;       -- アスベスト（未調査・調査済み なし・調査済み あり）
alter table projects add column if not exists building_notes text;          -- 建物の備考（隣接状況・電柱・残置物など）
