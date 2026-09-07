-- ---------------------------------------------------------------------------
-- Followers / following lists for any profile
--
-- `follows_select` only exposes edges the viewer is one of the two parties to, so reading
-- somebody else's followers or following straight off the table comes back empty. The apps show
-- those lists on every profile they can see, so this is a definer function that applies the same
-- visibility rule the counts in `profile_stats` already gate their detail on: your own account,
-- any public account, or a private one you are an accepted follower of.
--
-- Counts stay public (a private account still shows how many followers it has, like Instagram);
-- it is the *names* that need the follow.
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
  if list_kind not in ('followers', 'following') then
    raise exception 'list_kind must be followers or following, got %', list_kind;
  end if;

  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;

  if not private.can_view_profile_content(target.id) then
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

grant execute on function public.follow_list(extensions.citext, text, integer) to anon, authenticated;
