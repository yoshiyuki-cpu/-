-- LINE通知用：職長のLINEユーザーIDと、友達追加時に本人と紐付けるための一時コード
alter table workers add column if not exists line_user_id text;
alter table workers add column if not exists line_link_code text;
