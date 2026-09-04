-- 操作の記録（誰が・いつ・何をしたか）。ログインの第1段階。
--
-- 福田の現場が誰の手でごみ箱に入ったのか分からなかった。端末で選んだ名前を
-- 「ごみ箱に入れる／戻す／完工にする／記録を直す・消す」のときに残す。
-- 合言葉は無いのでなりすましは防げない。防ぐのは次の段階（本格的なログイン）で、
-- その時もこの表はそのまま使う。
create table if not exists audit_log (
  id serial primary key,
  -- 操作した人。作業員を消しても記録は残す。端末に名前が無ければ null
  actor_id integer references workers(id) on delete set null,
  actor_name text,
  -- 'trash' / 'restore' / 'purge' / 'complete' / 'reopen' / 'edit' / 'delete' など
  action text not null,
  -- 何に対して（表の名前と行のID）
  target_table text not null,
  target_id integer,
  -- 人が読める一言（例：「福田解体工事 をごみ箱に入れた」）
  summary text,
  created_at timestamptz default now()
);

create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_target_idx on audit_log (target_table, target_id);
