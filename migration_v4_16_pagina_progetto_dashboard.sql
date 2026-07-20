-- PNRR3 Basilicata V4.16 — pagina pubblica Il progetto e dashboard
begin;

create or replace function public.get_public_project_dashboard()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  candidate_count integer;
  linked_candidate_count integer;
  registered_user_count integer;
  preference_count integer;
  assignment_count integer;
  confirmed_assignment_count integer;
  assigned_school_count integer;
  class_counts jsonb;
  province_counts jsonb;
begin
  select count(*) into candidate_count
  from public.candidati;

  select count(*) into linked_candidate_count
  from public.candidati
  where user_id is not null;

  select count(*) into registered_user_count
  from auth.users;

  select coalesce(sum(
    case
      when jsonb_typeof(preferenze_scuole)='array'
        then jsonb_array_length(preferenze_scuole)
      else 0
    end
  ),0)::integer
  into preference_count
  from public.candidati;

  select count(*) into assignment_count
  from public.official_assignments;

  select count(*) into confirmed_assignment_count
  from public.official_assignments
  where match_status in ('confirmed','manual');

  select count(distinct codice_scuola) into assigned_school_count
  from public.official_assignments;

  select coalesce(jsonb_object_agg(insegnamento,total),'{}'::jsonb)
  into class_counts
  from (
    select insegnamento,count(*)::integer as total
    from public.official_assignments
    group by insegnamento
  ) x;

  select coalesce(jsonb_object_agg(provincia_assegnata,total),'{}'::jsonb)
  into province_counts
  from (
    select provincia_assegnata,count(*)::integer as total
    from public.official_assignments
    group by provincia_assegnata
  ) x;

  return jsonb_build_object(
    'candidate_count',candidate_count,
    'linked_candidate_count',linked_candidate_count,
    'registered_user_count',registered_user_count,
    'preference_count',preference_count,
    'assignment_count',assignment_count,
    'confirmed_assignment_count',confirmed_assignment_count,
    'assigned_school_count',assigned_school_count,
    'class_counts',class_counts,
    'province_counts',province_counts,
    'updated_at',now()
  );
end;
$$;

revoke all on function public.get_public_project_dashboard() from public;
grant execute on function public.get_public_project_dashboard()
to anon,authenticated;

notify pgrst,'reload schema';
commit;
