-- 見積りテーブル
create table estimates (
  id serial primary key,
  customer_name text not null,
  customer_address text,
  customer_contact text,
  site_address text,
  building_structure text,
  floor_area numeric(10,2),
  unit_price numeric(10,0),
  building_amount numeric(12,0) not null default 0,
  expense_rate numeric(5,2) not null default 0,
  discount_amount numeric(12,0) not null default 0,
  tax_rate numeric(5,2) not null default 10,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  issue_date date not null default current_date,
  valid_until date,
  notes text,
  created_at timestamptz default now()
);

-- 見積り内の廃材処分費項目
create table estimate_waste_items (
  id serial primary key,
  estimate_id integer references estimates(id) on delete cascade,
  waste_type_id integer references waste_types(id),
  name text not null,
  unit text not null default 'kg',
  quantity numeric(10,3) not null default 0,
  unit_price numeric(10,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- 見積り内の付帯工事項目（足場・養生・重機回送・アスベスト調査等）
create table estimate_extra_items (
  id serial primary key,
  estimate_id integer references estimates(id) on delete cascade,
  name text not null,
  amount numeric(12,0) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- 会社情報（見積書のヘッダー表示用・1行のみ）
create table company_settings (
  id integer primary key default 1,
  name text not null default '株式会社良心',
  postal_code text,
  address text default '岡山県岡山市南区豊浜町',
  tel text,
  fax text,
  license_no text,
  representative text,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

insert into company_settings (id, name, address)
values (1, '株式会社良心', '岡山県岡山市南区豊浜町')
on conflict (id) do nothing;
