-- ══════════════════════════════════════════════════════════
--  InstaSunx v2 — Supabase SQL Setup
--  Corré todo esto en SQL Editor de tu proyecto Supabase
-- ══════════════════════════════════════════════════════════

-- 1. PERFILES DE USUARIO
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null,
  username text unique not null,
  color text default '#ff2d55',
  interests text[] default '{}',
  created_at timestamptz default now()
);

-- 2. AMISTADES
create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references profiles(id) on delete cascade,
  user_b uuid references profiles(id) on delete cascade,
  status text default 'pending',  -- 'pending' | 'accepted'
  created_at timestamptz default now(),
  unique(user_a, user_b)
);

-- 3. MENSAJES
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id) on delete cascade,
  to_id uuid references profiles(id) on delete cascade,
  type text default 'text',          -- 'text' | 'reel'
  content text,                      -- texto del mensaje
  reply_to_id uuid,                  -- id del mensaje al que responde
  reply_to_text text,                -- preview del mensaje respondido
  reel_video_id text,                -- youtube video id
  reel_title text,
  reel_thumb text,
  reel_channel text,
  reel_embed_url text,
  created_at timestamptz default now()
);

-- 4. REACCIONES
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_id, user_id, emoji)
);

-- 5. LIKES (para la pestaña de amigos)
create table if not exists likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  video_id text not null,
  title text,
  thumb text,
  channel text,
  created_at timestamptz default now(),
  unique(user_id, video_id)
);

-- ══════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════

alter table profiles enable row level security;
alter table friendships enable row level security;
alter table messages enable row level security;
alter table reactions enable row level security;
alter table likes enable row level security;

-- PROFILES: todos pueden leer, solo vos podés modificar el tuyo
create policy "Leer perfiles" on profiles for select using (true);
create policy "Insertar propio perfil" on profiles for insert with check (true);
create policy "Actualizar propio perfil" on profiles for update using (auth.uid() = id);

-- FRIENDSHIPS: podés leer las tuyas, insertar si sos user_a
create policy "Ver propias amistades" on friendships for select
  using (user_a = auth.uid() or user_b = auth.uid());
create policy "Enviar solicitud" on friendships for insert
  with check (user_a = auth.uid());
create policy "Actualizar amistad" on friendships for update
  using (user_a = auth.uid() or user_b = auth.uid());
create policy "Eliminar amistad" on friendships for delete
  using (user_a = auth.uid() or user_b = auth.uid());

-- MESSAGES: podés leer y enviar los tuyos
create policy "Ver mensajes propios" on messages for select
  using (from_id = auth.uid() or to_id = auth.uid());
create policy "Enviar mensaje" on messages for insert
  with check (from_id = auth.uid());

-- REACTIONS
create policy "Ver reacciones" on reactions for select using (true);
create policy "Insertar reacción" on reactions for insert with check (user_id = auth.uid());
create policy "Eliminar reacción" on reactions for delete using (user_id = auth.uid());

-- LIKES: todos pueden ver los likes (para pestaña amigos)
create policy "Ver likes" on likes for select using (true);
create policy "Insertar like" on likes for insert with check (user_id = auth.uid());
create policy "Eliminar like" on likes for delete using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════
--  REALTIME (para mensajes en tiempo real)
-- ══════════════════════════════════════════════════════════
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table reactions;
alter publication supabase_realtime add table friendships;

-- ══════════════════════════════════════════════════════════
--  FUNCIÓN: crear perfil automáticamente al registrarse
-- ══════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name, username, color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    '#ff2d55'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
