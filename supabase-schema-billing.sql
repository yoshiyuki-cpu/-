-- 売上と請求書（2026-11 社長の依頼）。
-- これまでExcelで控えていた売上をアプリに入れ、毎月1日に先月分の請求書の下書きを作る。
--
-- 【注意】今は社長の指示で機能を先に作っている。権限は画面の目隠しで、RLSは入れていない。
-- anonキーで読める状態なので、アプリ全体のセキュリティを組むときに、このテーブルも
-- RLSとサーバー側のAPIへ移す。データの出し入れは lib/billing.ts に集めてある。
--
-- 既存のテーブルには触らない。何度実行しても壊れない。

-- 元請（請求書の宛先）。消さずに active で隠す
create table if not exists billing_clients (
  id serial primary key,
  name text not null,
  postal_code text,
  address text,
  honorific text not null default '御中',
  payment_note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 請求書に載せる発行者の情報。company_settings は見積と共用で内容が見本と違うので分けた。
-- 1行だけ持つ。角印は外から直接開けないよう、公開の写真置き場ではなくここに持つ
create table if not exists billing_settings (
  id integer primary key default 1 check (id = 1),
  issuer_name text,
  postal_code text,
  address text,
  office_name text,
  tel text,
  invoice_registration_no text,
  bank_name text,
  bank_branch text,
  account_type text default '普',
  account_number text,
  stamp_data text,
  updated_at timestamptz not null default now()
);

-- 売上を扱える人。社長は workers に居ないのでここにも入れず、社長の合言葉で入る
create table if not exists billing_members (
  id serial primary key,
  worker_id integer references workers(id) on delete set null,
  name text not null,
  role text not null default 'view' check (role in ('view', 'edit', 'confirm')),
  passcode_hash text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 売上の1行。請求書の明細はこの行をそのまま使う（二重に持つと食い違うため）。
-- construction：工事代金。amount は税込
-- daily：常用工事。amount は数量×単価で税抜
create table if not exists billing_entries (
  id serial primary key,
  project_id integer references projects(id) on delete set null,
  client_id integer references billing_clients(id) on delete set null,
  billing_month text check (billing_month is null or billing_month ~ '^[0-9]{4}-[0-9]{2}$'),
  line_type text not null default 'construction' check (line_type in ('construction', 'daily')),
  item_name text not null,
  quantity numeric not null default 1,
  unit text not null default '式',
  unit_price numeric,
  amount bigint not null default 0,
  note text,
  created_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_entries_month_idx on billing_entries (billing_month);
create index if not exists billing_entries_client_idx on billing_entries (client_id);

-- 請求書。元請と月で1通。確定すると、その時点の内容を snapshot に残して動かなくする
create table if not exists billing_invoices (
  id serial primary key,
  client_id integer references billing_clients(id) on delete set null,
  billing_month text not null check (billing_month ~ '^[0-9]{4}-[0-9]{2}$'),
  invoice_no text not null default '1',
  issue_date date not null,
  due_date date not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  snapshot jsonb,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 毎月の自動作成を何度動かしても同じ請求書が増えないように
  unique (client_id, billing_month)
);
