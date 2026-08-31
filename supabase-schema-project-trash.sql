-- 現場のごみ箱。
-- projectsを本当に削除すると、廃材・人工・写真・議事録・足場計算などの子テーブルが
-- cascadeで一緒に消えて元に戻せない。Supabaseの無料プランは自動バックアップが無いため、
-- 削除は deleted_at を立てて隠すだけにし、ごみ箱から元に戻せるようにする。
-- 中身は何も消さないので、戻せば記録もそのまま復活する。
alter table projects add column if not exists deleted_at timestamptz;

-- 一覧はごみ箱を除いて引くので、その絞り込みを速くする
create index if not exists projects_deleted_at_idx on projects (deleted_at);
