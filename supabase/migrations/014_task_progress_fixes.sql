-- Migration 014: Fix player_task_progress constraints
-- 1. Expand status check to include 'offered' and 'declined'
-- 2. Add unique indexes so upsert ON CONFLICT works
-- 3. Add guest-token RLS policy

-- Drop old status check, add new one with all valid statuses
alter table player_task_progress
  drop constraint if exists player_task_progress_status_check;

alter table player_task_progress
  add constraint player_task_progress_status_check
  check (status in ('available', 'offered', 'in_progress', 'completed', 'declined'));

-- Unique indexes for upsert conflict resolution
-- Partial: player_id rows (where player_id is not null)
create unique index if not exists uidx_player_task
  on player_task_progress (player_id, task_id)
  where player_id is not null;

-- Partial: guest_token rows (where guest_token is not null)
create unique index if not exists uidx_guest_task
  on player_task_progress (guest_token, task_id)
  where guest_token is not null;

-- RLS policy for guest access (guest_token-based rows)
drop policy if exists "Guest access own task progress" on player_task_progress;
create policy "Guest access own task progress"
  on player_task_progress for all
  using (guest_token is not null and player_id is null);
