-- 見積り機能を実際の運用（5大項目×自由項目の内訳明細）に合わせて作り直す
-- 注意: 既存のestimates関連テーブルとテストデータは削除されます

drop table if exists estimate_waste_items;
drop table if exists estimate_extra_items;
drop table if exists estimates cascade;

create table estimates (
  id serial primary key,
  customer_name text not null,
  customer_address text,
  customer_contact text,
  project_name text,
  site_address text,
  completion_date date,
  payment_due_date date,
  payment_terms text,
  assignee text,
  tax_rate numeric(5,2) not null default 10,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  issue_date date not null default current_date,
  valid_until date,
  notes text,
  created_at timestamptz default now()
);

-- 5大項目: demolition(解体工事代金) / temporary(仮設工事代金) / disposal(産業廃棄物処理費) / finishing(仕上げ工事代金) / other(その他諸経費)
create table estimate_items (
  id serial primary key,
  estimate_id integer references estimates(id) on delete cascade,
  category text not null check (category in ('demolition', 'temporary', 'disposal', 'finishing', 'other')),
  name text not null,
  quantity numeric(10,3) not null default 0,
  unit text not null default '式',
  unit_price numeric(12,2) not null default 0,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

alter table company_settings add column if not exists office_name text;
alter table company_settings add column if not exists email text;
alter table company_settings add column if not exists stamp_url text;
