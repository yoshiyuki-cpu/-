-- 車両・重機マスタ（リース／自社を区別。単価は空欄可＝入力時に都度金額を入れる運用にも対応）
create table vehicles (
  id serial primary key,
  name text not null,
  category text not null check (category in ('rental', 'owned')), -- rental=リース, owned=自社
  default_price numeric(10,2),
  unit text not null default '日',
  note text,
  created_at timestamptz default now()
);

-- その他費用記録に車両マスタへの参照を追加（entry_type='lease' の場合に使用。表示名は「リース代」→「車両代」に変更）
alter table other_entries
  add column if not exists vehicle_id integer references vehicles(id);

-- 置き場道具マスタ
create table tools (
  id serial primary key,
  name text not null,
  total_quantity integer not null default 0,
  broken_quantity integer not null default 0,
  unit text not null default '個',
  note text,
  created_at timestamptz default now()
);

-- 現場での道具貸出・返却記録（returned_atがnullなら貸出中）
create table tool_usages (
  id serial primary key,
  project_id integer references projects(id) on delete cascade,
  tool_id integer references tools(id) on delete cascade,
  quantity integer not null default 1,
  checked_out_at date not null,
  returned_at date,
  note text,
  created_at timestamptz default now()
);

-- 道具管理表（PDF）からの初期データ移行
-- 「置き場」以外の場所（軽トラ・銀色軽バン・白色軽バン・まさくん軽バン・築港・八軒屋・丸の内）は
-- すべて「置き場」在庫に集計し、「壊れてる道具」欄のみ broken_quantity として分離した
insert into tools (name, total_quantity, broken_quantity, unit) values
  ('レイキ', 7, 0, '本'),
  ('竹箒', 3, 0, '本'),
  ('箒', 5, 0, '本'),
  ('剣スコ大', 12, 0, '個'),
  ('剣スコ小', 5, 0, '個'),
  ('カクスコ', 4, 0, '個'),
  ('草刈機', 4, 1, '個'),
  ('くまで', 1, 0, '本'),
  ('エンジンカッター刃', 5, 0, '枚'),
  ('親綱', 2, 0, '本'),
  ('安全帯', 2, 0, '個'),
  ('軽油缶', 9, 0, '個'),
  ('携行缶', 3, 0, '個'),
  ('セメント', 4, 0, '袋'),
  ('クリッパー大', 1, 0, '個'),
  ('延長コード', 2, 1, '個'),
  ('ベビーサンダー', 1, 0, '個'),
  ('インパクト', 2, 0, '台'),
  ('ハイウォッシャー', 5, 2, '台'),
  ('タンク', 6, 0, '個'),
  ('6尺', 3, 0, '個'),
  ('7尺', 3, 0, '個'),
  ('8尺', 1, 0, '個'),
  ('台車', 4, 0, '台'),
  ('ケレン棒', 1, 0, '本'),
  ('噴霧器', 2, 0, '台'),
  ('ブラシ', 3, 0, '本'),
  ('トンボ', 2, 0, '本'),
  ('ちりとり', 3, 0, '個'),
  ('丸のこ', 2, 0, '台'),
  ('油圧オイル', 1, 0, 'つ'),
  ('混合ガソリン', 2, 0, 'つ'),
  ('チェンソーオイル', 1, 0, 'つ'),
  ('トンパック', 10, 0, '個'),
  ('集塵機', 1, 0, '台'),
  ('大ハンマー', 2, 0, 'つ'),
  ('テミ', 4, 0, '個'),
  ('バール', 5, 0, '本'),
  ('巻尺', 1, 0, 'つ'),
  ('ドラム', 3, 0, '個'),
  ('デカピックノミ', 2, 0, '本'),
  ('デカサンダー', 2, 1, '個'),
  ('鉄板ワイヤー', 1, 0, '本'),
  ('シート', 4, 0, '枚'),
  ('T放箒', 2, 0, '本'),
  ('シノ', 1, 0, 'つ'),
  ('セーバー', 3, 0, '台'),
  ('モンキー', 3, 0, '個'),
  ('塩ビパイプ（13）', 1, 0, '本'),
  ('発電機', 4, 3, '個'),
  ('短い掛谷', 1, 0, 'つ'),
  ('掛谷', 1, 0, 'つ'),
  ('ハーネス', 4, 0, '個');
