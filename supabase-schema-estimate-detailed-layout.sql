-- 見積りを「単一明細」と「内訳明細(カテゴリ別・複数ページ)」の2形式で使い分けられるようにする

alter table estimates
  add column if not exists layout_type text not null default 'simple' check (layout_type in ('simple', 'detailed'));

alter table estimates
  add column if not exists category_notes jsonb not null default '{}'::jsonb;

alter table estimate_items
  add column if not exists category text
  check (category in ('解体工事代金', '仮設工事代金', '産業廃棄物処理費', '仕上げ工事代金', 'その他諸経費'));
