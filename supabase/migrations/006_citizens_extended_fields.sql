-- Migration 006: Add extended fields to citizens table
-- These columns store dialogue, routine, trust stage text, and task data
-- that the seed script and game engine expect.

alter table citizens
  add column if not exists household     jsonb not null default '[]',
  add column if not exists mystery_ties  jsonb not null default '[]',
  add column if not exists trust_stages  jsonb not null default '{}',
  add column if not exists routine       jsonb not null default '{}',
  add column if not exists dialogue_topics jsonb not null default '{}',
  add column if not exists help_tasks    jsonb not null default '[]',
  add column if not exists lore_fact     text;
