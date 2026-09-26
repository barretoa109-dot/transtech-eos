-- Varias fotos con un pie de foto son UN pedido, no tres (v199).
--
-- ============================================================
-- LO QUE PASÓ (25 de septiembre de 2026, Sofía por WhatsApp)
-- ============================================================
--
-- Sofía mandó dos capturas de un pedido (2 prendas en una, 4 en la otra) con
-- un solo texto: "Pasame estas 6 prendas a guaraníes, 5.988,99 está el dólar".
-- EOS contestó TRES veces:
--
--   · "Por ahora puedo leer texto, imágenes, documentos y audios. Probá
--     mandarlo de otra forma." — a un mensaje de un tipo que el webhook no
--     conocía, que llegó junto con las fotos.
--   · "La imagen muestra un pedido con 4 artículos" — la foto SIN el texto:
--     la describió y no convirtió nada, porque nadie se lo había pedido.
--   · "En esta imagen se ven 2 prendas, no 6" — la foto CON el texto:
--     contradijo a la persona porque la otra foto no la vio nunca.
--
-- WhatsApp no manda un álbum como un mensaje: manda cada foto por separado, y
-- el pie de foto va pegado a UNA de ellas. El webhook atendía cada una por su
-- lado, en paralelo, así que ningún pedido tenía todo lo que la persona mandó.
--
-- ============================================================
-- QUÉ AGREGA
-- ============================================================
--
-- Una sala de espera por número. Cada mensaje que llega se anota acá; el
-- webhook espera unos segundos y, si en ese rato no llegó otro del mismo
-- número, toma TODOS los pendientes juntos y los procesa como un solo mensaje:
-- las fotos como varios adjuntos y los textos unidos en orden.
--
-- `eos_whatsapp_rafaga_tomar_v199` es la que decide quién procesa, sin
-- carreras: con un candado por teléfono, solo el último mensaje de la ráfaga
-- toma el lote, y un lote tomado no se vuelve a tomar. Un reintento de Meta
-- trae el mismo `wa_id` y choca con la clave única: no se procesa dos veces.
--
-- Solo service_role.

create table if not exists public.eos_whatsapp_rafaga_v199 (
  id bigint generated always as identity primary key,
  wa_id text not null unique,
  telefono text not null,
  tipo text not null,
  texto text,
  media_id text,
  mime_type text,
  nombre_archivo text,
  recibido_en timestamptz not null default clock_timestamp(),
  tomado_en timestamptz,
  lote text
);

create index if not exists eos_whatsapp_rafaga_v199_pendientes_idx
  on public.eos_whatsapp_rafaga_v199 (telefono, recibido_en)
  where tomado_en is null;

alter table public.eos_whatsapp_rafaga_v199 enable row level security;

revoke all on table public.eos_whatsapp_rafaga_v199 from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_whatsapp_rafaga_v199 to service_role;

comment on table public.eos_whatsapp_rafaga_v199 is
  'Mensajes de WhatsApp que llegan juntos (fotos de un álbum, foto + texto) esperando procesarse como uno solo. Solo service_role. Ver la v199.';

-- ============================================================
-- Tomar el lote: solo el último de la ráfaga, y una sola vez
-- ============================================================

create or replace function public.eos_whatsapp_rafaga_tomar_v199(
  p_telefono text,
  p_wa_id text
)
returns setof public.eos_whatsapp_rafaga_v199
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_mio timestamptz;
begin
  -- Un candado por teléfono: dos webhooks del mismo número no deciden a la vez.
  perform pg_advisory_xact_lock(hashtext('eos_whatsapp_rafaga_v199:' || p_telefono));

  -- La sala de espera no es un archivo: lo de hace más de dos días se va.
  delete from public.eos_whatsapp_rafaga_v199
  where telefono = p_telefono
    and recibido_en < now() - interval '2 days';

  select r.recibido_en into v_mio
  from public.eos_whatsapp_rafaga_v199 r
  where r.wa_id = p_wa_id
    and r.telefono = p_telefono
    and r.tomado_en is null;

  -- Ya lo tomó otro (un lote anterior o un reintento): nada que hacer.
  if v_mio is null then
    return;
  end if;

  -- Llegó uno más nuevo del mismo número: el lote lo toma ése.
  if exists (
    select 1
    from public.eos_whatsapp_rafaga_v199 r
    where r.telefono = p_telefono
      and r.tomado_en is null
      and (r.recibido_en, r.id) > (v_mio, (select x.id from public.eos_whatsapp_rafaga_v199 x where x.wa_id = p_wa_id))
  ) then
    return;
  end if;

  return query
  update public.eos_whatsapp_rafaga_v199 r
  set tomado_en = now(),
      lote = p_wa_id
  where r.telefono = p_telefono
    and r.tomado_en is null
    -- Lo que quedó colgado de hace mucho no se suma a este pedido.
    and r.recibido_en > now() - interval '10 minutes'
  returning r.*;
end;
$function$;

revoke all on function public.eos_whatsapp_rafaga_tomar_v199(text, text) from public, anon, authenticated;
grant execute on function public.eos_whatsapp_rafaga_tomar_v199(text, text) to service_role;

comment on function public.eos_whatsapp_rafaga_tomar_v199(text, text) is
  'v199: si p_wa_id es el último mensaje pendiente de ese teléfono, toma todos los pendientes (de los últimos 10 minutos) como un lote y los devuelve. Si no, no devuelve nada.';
