-- Migration 007: Add extended fields to items table

alter table items
  add column if not exists use_on text; -- target citizen/location id this item can be used on
