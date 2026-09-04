-- 着工前の確認（管路図・マニフェスト・近隣あいさつ・KY）。
--
-- 振り返りに「管路図を取っておらず、水道の本管を破損させた」とあった。
-- 着工前に見るべきものを現場ごとに並べ、誰がいつ確認したかを残す。
-- 項目は key で持つ（'pipes' / 'manifest' / 'neighbors' / 'ky'）。
-- 項目の名前や並びは画面側（lib/checklist.ts）で決め、増やすときはそちらに足す。
create table if not exists project_checks (
  id serial primary key,
  -- 現場を消したら確認の記録も要らない
  project_id integer references projects(id) on delete cascade,
  key text not null,
  done_at timestamptz,
  -- 確認した人。作業員を消しても記録は残す
  done_by integer references workers(id) on delete set null,
  note text,
  created_at timestamptz default now(),
  unique (project_id, key)
);
