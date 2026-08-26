-- 段取りに出す作業員を絞れるようにする。
-- 事務員や辞めた人を段取りから外したいが、人工記録が紐づいているため workers を削除できない
-- （削除すると過去の台帳が壊れる）。段取りに出すかどうかの印を持たせて、
-- 段取り画面からはこの印を落とすだけにし、他の画面や過去の記録はそのまま残す。
alter table workers add column if not exists in_dispatch boolean not null default true;
