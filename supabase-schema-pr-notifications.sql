-- 広報担当への夕方リマインダー用。
-- 職長（is_foreman）とは別の役割で、担当現場の割り当ては不要なため列の追加のみ。
-- 1人が両方の担当を兼ねることもできる。
alter table workers add column if not exists is_google_ads boolean not null default false;
alter table workers add column if not exists is_x_pr boolean not null default false;
