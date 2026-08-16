-- 共有カレンダー（着工・夜勤・見積もりなどの予定）
create table if not exists calendar_events (
  id serial primary key,
  title text not null,
  event_type text not null default 'other' check (event_type in ('construction_start', 'night_shift', 'estimate', 'other')),
  event_date date not null,
  note text,
  notify_all boolean not null default false,
  created_at timestamptz default now()
);

-- notify_all=falseの場合に、個別に通知する作業員を指定する
create table if not exists calendar_event_recipients (
  event_id integer references calendar_events(id) on delete cascade,
  worker_id integer references workers(id) on delete cascade,
  primary key (event_id, worker_id)
);
