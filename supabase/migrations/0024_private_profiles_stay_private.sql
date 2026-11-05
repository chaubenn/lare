-- Lare 0024: a private profile's content stays hidden from signed-out viewers.
--
-- `private.can_view_profile_content` is `owner = auth.uid() or <public account> or <accepted
-- follower>`. For an anonymous caller `auth.uid()` is null, so on a private account that reads
-- `null or false or false`, which is null, not false. RLS treats a null policy result as "no", so
-- the posts policies were fine, but the definer RPCs gate with `if not <helper> then <hide>`, and
-- `not null` is null, so the hiding branch never ran: signed-out callers got a private account's
-- solved grid (solved_activity), follower and following names (follow_list) and skills panel
-- (solved_skills), and `profile_stats` answered `visible: null` with the counts left off.
--
-- Fixed twice over: the helper now always returns a real boolean (false for anonymous viewers of
-- a private account, and false for a null owner), and every RPC that branches on it tests
-- `is not true`, so a future null can only ever hide content, never reveal it.
--
-- Other callers were checked: `private.can_view_post` (0018) ORs the helper into an RLS
-- expression, where null already meant "no"; `can_view_session`, `can_view_session_insights`,
-- `can_view_video` and the storage policies go through `can_view_post`. They need no change.
--
-- Idempotent: safe to run twice.

create or replace function private.can_view_profile_content(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select owner is not null
    and (
      coalesce(owner = auth.uid(), false)
      or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
      or private.is_accepted_follower(owner)
    );
$$;

-- ---------------------------------------------------------------------------
-- profile_stats (0002): `visible` is reported to the client, so it must be a boolean.
-- ---------------------------------------------------------------------------
create or replace function public.profile_stats(target_handle extensions.citext)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
  visible boolean;
  result jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;
  visible := coalesce(private.can_view_profile_content(target.id), false);
  result := jsonb_build_object(
    'followers', (select count(*) from public.follows where followee_id = target.id and status = 'accepted'),
    'following', (select count(*) from public.follows where follower_id = target.id and status = 'accepted'),
    'visible', visible
  );
  if visible then
    result := result || jsonb_build_object(
      'posts', (select count(*) from public.posts where user_id = target.id and status = 'published' and visibility = 'public'),
      'problems_solved', (
        select count(distinct sp.slug)
        from public.session_problems sp
        join public.sessions s on s.id = sp.session_id
        join public.submissions su on su.session_problem_id = sp.id and su.accepted
        where s.user_id = target.id
      ),
      'total_active_ms', (select coalesce(sum(active_ms), 0) from public.sessions where user_id = target.id and status = 'ended')
    );
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- solved_activity (0006)
-- ---------------------------------------------------------------------------
create or replace function public.solved_activity(
  target_handle extensions.citext,
  days integer default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  window_days integer := least(greatest(coalesce(days, 365), 7), 366);
  first_day date := (now() at time zone 'utc')::date - (window_days - 1);
  last_day date := (now() at time zone 'utc')::date;
  buckets jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;

  if private.can_view_profile_content(target.id) is not true then
    return jsonb_build_object(
      'visible', false, 'start', first_day, 'end', last_day,
      'days', '[]'::jsonb, 'total', 0, 'max', 0, 'all_time', 0
    );
  end if;

  with solved as (
    select distinct
      (su.submitted_at at time zone 'utc')::date as day,
      sp.slug
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    where s.user_id = target.id
      and su.accepted
      and (su.submitted_at at time zone 'utc')::date between first_day and last_day
  ), per_day as (
    select day, count(*)::int as solves from solved group by day
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('day', day, 'count', solves) order by day),
    '[]'::jsonb
  ) into buckets
  from per_day;

  return jsonb_build_object(
    'visible', true,
    'start', first_day,
    'end', last_day,
    'days', buckets,
    'total', (select coalesce(sum((d ->> 'count')::int), 0) from jsonb_array_elements(buckets) d),
    'max', (select coalesce(max((d ->> 'count')::int), 0) from jsonb_array_elements(buckets) d),
    'all_time', (
      select count(distinct sp.slug)
      from public.session_problems sp
      join public.sessions s on s.id = sp.session_id
      join public.submissions su on su.session_problem_id = sp.id and su.accepted
      where s.user_id = target.id
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- follow_list (0011)
-- ---------------------------------------------------------------------------
create or replace function public.follow_list(
  target_handle extensions.citext,
  list_kind text,
  max_rows integer default 200
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
  row_cap integer := greatest(1, least(coalesce(max_rows, 200), 500));
  people jsonb;
begin
  if list_kind is null or list_kind not in ('followers', 'following') then
    raise exception 'list_kind must be followers or following, got %', list_kind;
  end if;

  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;

  if private.can_view_profile_content(target.id) is not true then
    return jsonb_build_object('visible', false, 'people', '[]'::jsonb);
  end if;

  -- The cap has to be applied to the rows, not to the aggregate, hence the subquery.
  -- Newest edge first, matching the friends tab's own lists.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'handle', e.handle,
        'display_name', e.display_name,
        'avatar_url', e.avatar_url,
        'is_private', e.is_private
      )
      order by e.followed_at desc
    ),
    '[]'::jsonb
  )
  into people
  from (
    select p.id, p.handle, p.display_name, p.avatar_url, p.is_private, f.created_at as followed_at
    from public.follows f
    join public.profiles p
      on p.id = case when list_kind = 'followers' then f.follower_id else f.followee_id end
    where f.status = 'accepted'
      and case when list_kind = 'followers' then f.followee_id else f.follower_id end = target.id
      and p.handle is not null
    order by f.created_at desc
    limit row_cap
  ) e;

  return jsonb_build_object('visible', true, 'people', people);
end $$;

-- ---------------------------------------------------------------------------
-- solved_skills (0016)
-- ---------------------------------------------------------------------------
create or replace function public.solved_skills(target_handle extensions.citext)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  solved jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;

  if private.can_view_profile_content(target.id) is not true then
    return jsonb_build_object('visible', false, 'problems', '[]'::jsonb);
  end if;

  with accepted as (
    select distinct on (sp.slug)
      sp.slug,
      sp.difficulty,
      sp.topic_tags
    from public.session_problems sp
    join public.sessions s on s.id = sp.session_id
    where s.user_id = target.id
      and exists (
        select 1 from public.submissions su where su.session_problem_id = sp.id and su.accepted
      )
    order by sp.slug, (jsonb_array_length(sp.topic_tags) > 0) desc, sp.opened_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', slug,
        'difficulty', difficulty,
        'tags', coalesce(
          (
            select jsonb_agg(jsonb_build_object('slug', t ->> 'slug', 'name', t ->> 'name'))
            from jsonb_array_elements(topic_tags) t
            where t ? 'slug' and t ? 'name'
          ),
          '[]'::jsonb
        )
      )
      order by slug
    ),
    '[]'::jsonb
  ) into solved
  from accepted;

  return jsonb_build_object('visible', true, 'problems', solved);
end $$;

grant execute on function public.profile_stats(extensions.citext) to anon, authenticated;
grant execute on function public.solved_activity(extensions.citext, integer) to anon, authenticated;
grant execute on function public.follow_list(extensions.citext, text, integer) to anon, authenticated;
grant execute on function public.solved_skills(extensions.citext) to anon, authenticated;
