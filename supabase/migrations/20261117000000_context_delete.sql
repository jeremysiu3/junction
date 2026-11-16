-- Deleting a decision that was replaced leaves its replacement standing on its own instead of failing.
alter table context_entries drop constraint context_entries_replaces_id_fkey;
alter table context_entries add constraint context_entries_replaces_id_fkey
  foreign key (replaces_id) references context_entries(id) on delete set null;
