-- Planilla colaborativa de mezclas — base compartida en Supabase.
-- Pegar todo esto en el SQL Editor del proyecto y ejecutarlo una sola vez.
-- Se puede volver a ejecutar sin romper nada.

-- ---------------------------------------------------------------- tablas ---
create table if not exists public.mezclas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text        not null default 'Mezcla',
  tipo            text        not null default '',
  -- claves = "id" de columna de datos/esquema.json (obra_informe, c1_pct_ca, ...)
  datos           jsonb       not null default '{}'::jsonb,
  aportante       text        not null default '',
  borrada         boolean     not null default false,
  creada          timestamptz not null default now(),
  actualizada     timestamptz not null default now(),
  actualizada_por text        not null default ''
);

create index if not exists mezclas_orden on public.mezclas (creada);

-- Quién está conectado y qué celda está tocando (para mostrarlo en vivo).
create table if not exists public.presencias (
  id     text primary key,               -- identificador del navegador
  nombre text        not null default '',
  foco   text        not null default '', -- "<fila>|<columna>" que está editando
  visto  timestamptz not null default now()
);

-- ------------------------------------------------------------- funciones ---
-- Mezcla los datos campo por campo: dos personas pueden editar celdas
-- distintas de la misma fila sin pisarse. Un valor null borra ese campo.
create or replace function public.parchear_mezcla(
  p_id     uuid,
  p_datos  jsonb default '{}'::jsonb,
  p_nombre text  default null,
  p_tipo   text  default null,
  p_quien  text  default ''
) returns public.mezclas
language plpgsql
as $$
declare
  v_nulas text[];
  v_fila  public.mezclas;
begin
  select coalesce(array_agg(e.key), '{}'::text[]) into v_nulas
    from jsonb_each(p_datos) as e(key, value)
   where e.value = 'null'::jsonb;

  update public.mezclas
     set datos           = (coalesce(datos, '{}'::jsonb) || (p_datos - v_nulas)) - v_nulas,
         nombre          = coalesce(p_nombre, nombre),
         tipo            = coalesce(p_tipo, tipo),
         actualizada     = now(),
         actualizada_por = coalesce(nullif(p_quien, ''), actualizada_por)
   where id = p_id and not borrada
   returning * into v_fila;

  return v_fila;
end;
$$;

-- Borrado lógico: la fila queda en la base, deja de verse en la planilla.
create or replace function public.borrar_mezcla(p_id uuid, p_quien text default '')
returns public.mezclas
language sql
as $$
  update public.mezclas
     set borrada = true, actualizada = now(), actualizada_por = p_quien
   where id = p_id
   returning *;
$$;

-- Presencia: la marca de tiempo la pone el servidor, así no depende de que el
-- reloj de cada navegador esté en hora.
create or replace function public.tocar_presencia(p_id text, p_nombre text default '', p_foco text default '')
returns void
language sql
as $$
  insert into public.presencias (id, nombre, foco, visto)
  values (p_id, coalesce(p_nombre, ''), coalesce(p_foco, ''), now())
  on conflict (id) do update
     set nombre = excluded.nombre, foco = excluded.foco, visto = now();
$$;

create or replace function public.presentes(p_segundos integer default 45)
returns setof public.presencias
language sql
stable
as $$
  select * from public.presencias where visto > now() - make_interval(secs => greatest(p_segundos, 5));
$$;

-- ------------------------------------------------------------------ RLS ----
-- La planilla es abierta a quien tenga el link: se puede leer, agregar y
-- editar, pero no borrar físicamente ni vaciar la tabla.
alter table public.mezclas    enable row level security;
alter table public.presencias enable row level security;

drop policy if exists mezclas_leer   on public.mezclas;
drop policy if exists mezclas_crear  on public.mezclas;
drop policy if exists mezclas_editar on public.mezclas;
create policy mezclas_leer   on public.mezclas for select using (true);
create policy mezclas_crear  on public.mezclas for insert with check (true);
create policy mezclas_editar on public.mezclas for update using (true) with check (true);
-- (a propósito no hay policy de delete: nadie puede borrar filas de verdad)

drop policy if exists presencias_leer  on public.presencias;
drop policy if exists presencias_crear on public.presencias;
drop policy if exists presencias_edit  on public.presencias;
create policy presencias_leer  on public.presencias for select using (true);
create policy presencias_crear on public.presencias for insert with check (true);
create policy presencias_edit  on public.presencias for update using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.mezclas, public.presencias to anon, authenticated;
grant execute on function public.parchear_mezcla(uuid, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.borrar_mezcla(uuid, text) to anon, authenticated;
grant execute on function public.tocar_presencia(text, text, text) to anon, authenticated;
grant execute on function public.presentes(integer) to anon, authenticated;

-- -------------------------------------------------------------- realtime ---
-- Avisos instantáneos por WebSocket (si falla, la página igual se
-- sincroniza sondeando cada pocos segundos).
alter table public.mezclas    replica identity full;
alter table public.presencias replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin
    alter publication supabase_realtime add table public.mezclas;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.presencias;
  exception when duplicate_object then null;
  end;
end $$;

-- ------------------------------------------------------------- limpieza ----
-- Opcional: borrar presencias viejas de vez en cuando.
-- delete from public.presencias where visto < now() - interval '1 day';
