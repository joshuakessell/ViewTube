-- A shared playlist per room.
--
-- The table is not readable or writable directly: every row carries a room
-- code, and a room code is what lets someone join that room's call, so the
-- codes must not be listable. The functions below are the only way in, and
-- each one needs the caller to already know the room code.

create table public.playlist_items (
  id bigint generated always as identity primary key,
  room text not null check (room ~ '^[a-z0-9-]{3,40}$'),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '' check (char_length(title) <= 200),
  author text not null default '' check (char_length(author) <= 120),
  duration integer check (duration is null or duration between 0 and 360000),
  added_by text not null default '' check (char_length(added_by) <= 24),
  sort double precision not null,
  created_at timestamptz not null default now(),
  unique (room, video_id)
);

create index playlist_items_room_sort on public.playlist_items (room, sort, id);

alter table public.playlist_items enable row level security;
revoke all on public.playlist_items from anon, authenticated;

create function public.playlist_list(p_room text)
returns table (video_id text, title text, author text, duration integer, added_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.video_id, i.title, i.author, i.duration, i.added_by
  from public.playlist_items i
  where i.room = p_room
  order by i.sort, i.id;
$$;

create function public.playlist_add(
  p_room text,
  p_video_id text,
  p_title text default '',
  p_author text default '',
  p_duration integer default null,
  p_added_by text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer;
  last_sort double precision;
begin
  select count(*), coalesce(max(i.sort), 0)
    into item_count, last_sort
    from public.playlist_items i
   where i.room = p_room;

  if item_count >= 200 then
    raise exception 'This playlist is full (200 videos).';
  end if;

  insert into public.playlist_items (room, video_id, title, author, duration, added_by, sort)
  values (
    p_room,
    p_video_id,
    left(coalesce(p_title, ''), 200),
    left(coalesce(p_author, ''), 120),
    p_duration,
    left(coalesce(p_added_by, ''), 24),
    last_sort + 1
  )
  on conflict (room, video_id) do nothing;
end;
$$;

create function public.playlist_remove(p_room text, p_video_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.playlist_items i
   where i.room = p_room and i.video_id = p_video_id;
$$;

revoke execute on function public.playlist_list(text) from public;
revoke execute on function public.playlist_add(text, text, text, text, integer, text) from public;
revoke execute on function public.playlist_remove(text, text) from public;
-- The app never signs anyone in, so only the public (anon) role needs these.
grant execute on function public.playlist_list(text) to anon;
grant execute on function public.playlist_add(text, text, text, text, integer, text) to anon;
grant execute on function public.playlist_remove(text, text) to anon;
