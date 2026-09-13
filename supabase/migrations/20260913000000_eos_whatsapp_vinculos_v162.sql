-- Vínculo de WhatsApp: qué número de teléfono es cuál cuenta de EOS.
--
-- ============================================================
-- POR QUÉ UN CÓDIGO Y NO EL NÚMERO YA CARGADO
-- ============================================================
--
-- `usuarios.whatsapp` ya existe (se pide para el catastro de tarjeta de
-- Bancard), pero es un campo de texto sin verificar: nadie confirmó que ese
-- número sea realmente suyo. Confiar en él para decidir qué cuenta atiende
-- un mensaje de WhatsApp significa que un número mal tipeado, o cambiado de
-- dueño, filtra el negocio de una persona a otra.
--
-- Por eso la vinculación es al revés: la persona pide un código desde la
-- web (donde ya probó quién es, con su sesión), lo manda por WhatsApp, y
-- recién ahí se graba el número. El código es la prueba de que ese teléfono
-- puede recibir mensajes que esa cuenta autorizó.
--
-- ============================================================
-- POR QUÉ NO HAY MÁS DE UN NÚMERO POR CUENTA (TODAVÍA)
-- ============================================================
--
-- `usuario_id` es `unique`: una cuenta, un número. No porque no tenga
-- sentido tener más de uno, sino porque nada del resto del sistema (el
-- webhook, la conversación de WhatsApp) sabe hoy elegir entre varios. Ampliar
-- esto es agregar una columna, no rehacer la tabla.

create table if not exists public.eos_whatsapp_vinculos_v162 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references auth.users(id) on delete cascade,

  -- E.164 (ej. "595981123456"), tal como lo manda la API de WhatsApp en
  -- `messages[].from`. Nulo hasta que se confirma el código.
  telefono text unique,

  -- El código pendiente. Se guarda en texto plano a propósito: no protege
  -- nada más allá de su propia ventana de 10 minutos, y un hash acá sería
  -- una capa sin beneficio real.
  codigo text,
  codigo_expira_at timestamptz,

  -- La conversación de WhatsApp de esta cuenta, creada la primera vez que
  -- llega un mensaje ya vinculado. Una sola por cuenta, igual que el
  -- teléfono: es el mismo motivo, todavía no hay UI que distinga varias.
  conversacion_id uuid references public.conversaciones(id),

  verificado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evita que dos códigos pendientes coincidan por casualidad mientras los dos
-- siguen sin confirmar. Una vez verificado, el código deja de importar y no
-- hace falta que siga siendo único.
create unique index if not exists eos_whatsapp_vinculos_codigo_pendiente_idx
  on public.eos_whatsapp_vinculos_v162 (codigo)
  where verificado_at is null and codigo is not null;

comment on table public.eos_whatsapp_vinculos_v162 is
  'Qué número de WhatsApp corresponde a qué cuenta de EOS. Se llega ahí por código de un solo uso pedido desde la web, nunca por el campo usuarios.whatsapp (sin verificar).';

comment on column public.eos_whatsapp_vinculos_v162.telefono is
  'E.164 sin el signo +, como lo manda la API de WhatsApp. Nulo hasta confirmar el código.';

alter table public.eos_whatsapp_vinculos_v162 enable row level security;

-- El webhook de WhatsApp corre con `service_role`, que salta la RLS de
-- todos modos: estas políticas son para el endpoint que genera el código
-- (`/api/whatsapp/vincular`), que sí corre con la sesión de la persona.
drop policy if exists whatsapp_vinculos_select on public.eos_whatsapp_vinculos_v162;
create policy whatsapp_vinculos_select on public.eos_whatsapp_vinculos_v162
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists whatsapp_vinculos_insert on public.eos_whatsapp_vinculos_v162;
create policy whatsapp_vinculos_insert on public.eos_whatsapp_vinculos_v162
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists whatsapp_vinculos_update on public.eos_whatsapp_vinculos_v162;
create policy whatsapp_vinculos_update on public.eos_whatsapp_vinculos_v162
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists whatsapp_vinculos_delete on public.eos_whatsapp_vinculos_v162;
create policy whatsapp_vinculos_delete on public.eos_whatsapp_vinculos_v162
  for delete to authenticated using ((select auth.uid()) = usuario_id);

revoke all on public.eos_whatsapp_vinculos_v162 from anon;
