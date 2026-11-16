-- .CUT barbershop (Tlemcen) — réservations, schéma isolé « cutbarber ». Idempotent.
-- Accès client : uniquement via fonctions public.cutbarber_* (security definer),
-- aucun changement de la liste « Exposed schemas ».
create schema if not exists cutbarber;
revoke all on schema cutbarber from public, anon, authenticated;

create table if not exists cutbarber.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists cutbarber.barbers (
  id serial primary key,
  name text not null check (char_length(name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 300),
  active boolean not null default true,
  sort int not null default 0
);
create table if not exists cutbarber.services (
  id serial primary key,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  price_da int check (price_da is null or price_da between 0 and 1000000),
  duration_min int not null check (duration_min between 5 and 480),
  to_confirm boolean not null default true,
  active boolean not null default true,
  sort int not null default 0
);
-- jour : 0 = dimanche … 6 = samedi ; minutes depuis minuit, fermeture jusqu'à 1440 (minuit)
create table if not exists cutbarber.hours (
  dow smallint primary key check (dow between 0 and 6),
  closed boolean not null default false,
  open_min int not null default 600 check (open_min between 0 and 1440),
  close_min int not null default 1380 check (close_min between 0 and 1440),
  check (closed or close_min > open_min)
);
create table if not exists cutbarber.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id int not null references cutbarber.barbers(id),
  service_id int not null references cutbarber.services(id),
  service_name text not null,
  price_da int,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  client_name text not null check (char_length(client_name) between 2 and 60),
  client_phone text not null check (client_phone ~ '^\+?[0-9 .-]{8,20}$'),
  status text not null default 'booked' check (status in ('booked','done','cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists appointments_barber_time on cutbarber.appointments (barber_id, starts_at);

alter table cutbarber.admins enable row level security;
alter table cutbarber.barbers enable row level security;
alter table cutbarber.services enable row level security;
alter table cutbarber.hours enable row level security;
alter table cutbarber.appointments enable row level security;
-- aucune politique : tables fermées à anon/authenticated ; tout passe par les fonctions ci-dessous.
revoke all on all tables in schema cutbarber from public, anon, authenticated;

create or replace function cutbarber.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists(select 1 from cutbarber.admins a where a.user_id = auth.uid());
$$;

-- Anti double réservation (par barbier), même en cas d'envois simultanés.
create or replace function cutbarber.appointments_no_overlap() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('cutbarber-barber-' || new.barber_id));
  if exists (select 1 from cutbarber.appointments a
             where a.barber_id = new.barber_id and a.status <> 'cancelled' and a.id <> new.id
               and a.starts_at < new.ends_at and a.ends_at > new.starts_at) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists trg_no_overlap on cutbarber.appointments;
create trigger trg_no_overlap before insert or update of starts_at, ends_at, barber_id, status
  on cutbarber.appointments for each row execute function cutbarber.appointments_no_overlap();

-- ===== Fonctions publiques (anon) =====
create or replace function public.cutbarber_public_info() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'barbers', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'bio',bio) order by sort, id) from cutbarber.barbers where active), '[]'),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'price_da',price_da,'duration_min',duration_min,'to_confirm',to_confirm) order by sort, id) from cutbarber.services where active), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('dow',dow,'closed',closed,'open_min',open_min,'close_min',close_min) order by dow) from cutbarber.hours), '[]'));
$$;

-- Créneaux occupés : aucune donnée personnelle.
create or replace function public.cutbarber_busy(p_from timestamptz, p_to timestamptz)
  returns table (barber_id int, starts_at timestamptz, ends_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select a.barber_id, a.starts_at, a.ends_at from cutbarber.appointments a
  where a.status <> 'cancelled' and a.starts_at < p_to and a.ends_at > p_from
    and p_to - p_from <= interval '40 days';
$$;

create or replace function public.cutbarber_book(p_service_id int, p_barber_id int, p_starts_at timestamptz, p_name text, p_phone text)
  returns jsonb language plpgsql security definer set search_path = '' as $$
declare s cutbarber.services; h cutbarber.hours; loc timestamp; m int; e timestamptz;
        b record; new_id uuid; chosen int; chosen_name text;
begin
  p_name := btrim(coalesce(p_name,'')); p_phone := btrim(coalesce(p_phone,''));
  if char_length(p_name) < 2 or char_length(p_name) > 60 then raise exception 'bad_name'; end if;
  if p_phone !~ '^\+?[0-9 .-]{8,20}$' then raise exception 'bad_phone'; end if;
  select * into s from cutbarber.services where id = p_service_id and active;
  if not found then raise exception 'bad_service'; end if;
  if p_starts_at < now() + interval '15 minutes' or p_starts_at > now() + interval '60 days' then raise exception 'bad_time'; end if;
  loc := p_starts_at at time zone 'Africa/Algiers';
  m := extract(hour from loc)::int * 60 + extract(minute from loc)::int;
  if extract(second from loc) <> 0 then raise exception 'bad_time'; end if;
  select * into h from cutbarber.hours where dow = extract(dow from loc)::int;
  if not found or h.closed or m < h.open_min or m + s.duration_min > h.close_min then raise exception 'closed'; end if;
  -- créneaux toutes les 30 min à partir de l'ouverture (10:00, 10:30, 11:00…)
  if (m - h.open_min) % 30 <> 0 then raise exception 'bad_time'; end if;
  e := p_starts_at + make_interval(mins => s.duration_min);
  if (select count(*) from cutbarber.appointments a where a.client_phone = p_phone and a.status = 'booked' and a.starts_at > now()) >= 3 then
    raise exception 'too_many';
  end if;
  for b in select id, name from cutbarber.barbers
           where active and (p_barber_id is null or id = p_barber_id) order by sort, id loop
    begin
      insert into cutbarber.appointments (barber_id, service_id, service_name, price_da, starts_at, ends_at, client_name, client_phone)
      values (b.id, s.id, s.name, s.price_da, p_starts_at, e, p_name, p_phone) returning id into new_id;
      chosen := b.id; chosen_name := b.name; exit;
    exception when raise_exception then
      if sqlerrm <> 'slot_taken' then raise; end if;
    end;
  end loop;
  if new_id is null then
    if p_barber_id is not null and not exists (select 1 from cutbarber.barbers where id = p_barber_id and active) then raise exception 'bad_barber'; end if;
    raise exception 'slot_taken';
  end if;
  return jsonb_build_object('id', new_id, 'barber_id', chosen, 'barber_name', chosen_name, 'service', s.name, 'starts_at', p_starts_at, 'ends_at', e);
end; $$;

-- ===== Fonctions admin (authenticated + is_admin) =====
create or replace function public.cutbarber_is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$ select cutbarber.is_admin(); $$;

create or replace function public.cutbarber_admin_appointments(p_from timestamptz, p_to timestamptz)
  returns setof cutbarber.appointments language plpgsql stable security definer set search_path = '' as $$
begin
  if not cutbarber.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select * from cutbarber.appointments a where a.starts_at < p_to and a.ends_at > p_from order by a.starts_at;
end; $$;

create or replace function public.cutbarber_admin_set_status(p_id uuid, p_status text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not cutbarber.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update cutbarber.appointments set status = p_status where id = p_id;
end; $$;

create or replace function public.cutbarber_admin_config() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not cutbarber.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'barbers', coalesce((select jsonb_agg(to_jsonb(x) order by sort, id) from cutbarber.barbers x), '[]'),
    'services', coalesce((select jsonb_agg(to_jsonb(x) order by sort, id) from cutbarber.services x), '[]'),
    'hours', coalesce((select jsonb_agg(to_jsonb(x) order by dow) from cutbarber.hours x), '[]'));
end; $$;

-- Enregistre barbiers / prestations / horaires. Un élément sans id est créé ;
-- « active: false » le masque (pas de suppression, l'historique des RDV reste lisible).
create or replace function public.cutbarber_admin_save_config(payload jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  if not cutbarber.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(payload->'barbers','[]')) loop
    if x ? 'id' and x->>'id' is not null then
      update cutbarber.barbers set name = x->>'name', bio = coalesce(x->>'bio',''), active = coalesce((x->>'active')::boolean, true), sort = coalesce((x->>'sort')::int, 0) where id = (x->>'id')::int;
    else
      insert into cutbarber.barbers (name, bio, active, sort) values (x->>'name', coalesce(x->>'bio',''), coalesce((x->>'active')::boolean, true), coalesce((x->>'sort')::int, 0));
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(payload->'services','[]')) loop
    if x ? 'id' and x->>'id' is not null then
      update cutbarber.services set name = x->>'name', description = coalesce(x->>'description',''), price_da = nullif(x->>'price_da','')::int,
        duration_min = (x->>'duration_min')::int, to_confirm = coalesce((x->>'to_confirm')::boolean, false),
        active = coalesce((x->>'active')::boolean, true), sort = coalesce((x->>'sort')::int, 0) where id = (x->>'id')::int;
    else
      insert into cutbarber.services (name, description, price_da, duration_min, to_confirm, active, sort)
      values (x->>'name', coalesce(x->>'description',''), nullif(x->>'price_da','')::int, (x->>'duration_min')::int,
              coalesce((x->>'to_confirm')::boolean, false), coalesce((x->>'active')::boolean, true), coalesce((x->>'sort')::int, 0));
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(payload->'hours','[]')) loop
    update cutbarber.hours set closed = coalesce((x->>'closed')::boolean, false), open_min = (x->>'open_min')::int, close_min = (x->>'close_min')::int
      where dow = (x->>'dow')::int;
  end loop;
end; $$;

revoke all on function public.cutbarber_public_info(), public.cutbarber_busy(timestamptz,timestamptz),
  public.cutbarber_book(int,int,timestamptz,text,text), public.cutbarber_is_admin(),
  public.cutbarber_admin_appointments(timestamptz,timestamptz), public.cutbarber_admin_set_status(uuid,text),
  public.cutbarber_admin_config(), public.cutbarber_admin_save_config(jsonb) from public;
grant execute on function public.cutbarber_public_info(), public.cutbarber_busy(timestamptz,timestamptz),
  public.cutbarber_book(int,int,timestamptz,text,text), public.cutbarber_is_admin() to anon, authenticated;
grant execute on function public.cutbarber_admin_appointments(timestamptz,timestamptz), public.cutbarber_admin_set_status(uuid,text),
  public.cutbarber_admin_config(), public.cutbarber_admin_save_config(jsonb) to authenticated;
revoke all on function cutbarber.is_admin(), cutbarber.appointments_no_overlap() from public;
