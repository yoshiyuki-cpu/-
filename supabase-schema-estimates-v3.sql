-- 見積書のレイアウトを実際のPDF雛形（1枚・単一明細リスト形式）に合わせる
-- 5大項目分類を廃止し、estimate_itemsはNo付きのフラットな明細リストにする
-- 既存の項目名・単価・数量・単位のデータは保持される（category/noteのみ削除）

alter table estimates add column if not exists estimate_no text;
alter table estimates add column if not exists customer_honorific text not null default '様';
alter table estimates add column if not exists construction_period text;
alter table estimates drop column if exists completion_date;
alter table estimates alter column payment_due_date type text using payment_due_date::text;

alter table estimate_items drop column if exists category;
alter table estimate_items drop column if exists note;
