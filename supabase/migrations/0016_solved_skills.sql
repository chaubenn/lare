-- ---------------------------------------------------------------------------
-- solved_skills(target_handle) -> every distinct problem a user has solved, for the profile's
-- skills panel (topics radar, difficulty split, top topics)
-- ---------------------------------------------------------------------------
-- Same shape of rules as solved_activity (0006): counts accepted submissions straight from the
-- session tables, so unposted and privately posted work still counts, and security definer
-- because `submissions` is owner-only under RLS. The privacy gate is the same
-- `can_view_profile_content`, so a private account's skills stay hidden from non-followers.
--
-- One row per slug: a problem solved in five sessions is one solved problem. Its tags come from
-- the newest capture that has any (older captures may predate topic tag collection).
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

  if not private.can_view_profile_content(target.id) then
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

grant execute on function public.solved_skills(extensions.citext) to anon, authenticated;
