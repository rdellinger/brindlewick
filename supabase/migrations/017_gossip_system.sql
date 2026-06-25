-- Add gossip_rating (1-10) to citizens, default 5
alter table citizens add column if not exists gossip_rating integer not null default 5
  check (gossip_rating between 1 and 10);

-- Gossip items: a piece of information that can spread through town
create table if not exists gossip_items (
  id          uuid primary key default uuid_generate_v4(),
  content     text not null,             -- "The visitor mentioned they're from Boston"
  subject     text not null default 'player', -- 'player' | citizen_id
  category    text not null default 'player_fact',  -- 'player_fact' | 'player_action' | 'citizen_rumor'
  player_key  text,                      -- 'player:{uuid}' or 'guest:{token}' — null for NPC-only gossip
  origin_citizen_id text references citizens(id) on delete set null,
  created_at  timestamptz default now()
);

-- Which citizens know which gossip items
create table if not exists citizen_gossip (
  citizen_id  text not null references citizens(id) on delete cascade,
  gossip_id   uuid not null references gossip_items(id) on delete cascade,
  learned_at  timestamptz default now(),
  times_shared integer not null default 0,
  primary key (citizen_id, gossip_id)
);

-- Indexes
create index if not exists idx_gossip_items_player_key on gossip_items(player_key);
create index if not exists idx_citizen_gossip_citizen on citizen_gossip(citizen_id);
create index if not exists idx_citizen_gossip_gossip on citizen_gossip(gossip_id);

-- RLS: public read
alter table gossip_items enable row level security;
alter table citizen_gossip enable row level security;
create policy "public read gossip_items" on gossip_items for select using (true);
create policy "public read citizen_gossip" on citizen_gossip for select using (true);

-- RPC to increment times_shared for a gossip item
create or replace function increment_gossip_shared_count(p_gossip_id uuid)
returns void language plpgsql as $$
begin
  update citizen_gossip set times_shared = times_shared + 1
  where gossip_id = p_gossip_id;
end;
$$;
