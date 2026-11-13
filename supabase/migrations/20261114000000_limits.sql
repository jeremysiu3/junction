-- M6 abuse limits: who created a project, so projects per user can be counted. Null for existing rows.
alter table projects add column created_by uuid references users(id) on delete set null;
