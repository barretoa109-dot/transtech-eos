-- El costo de las llamadas al modelo que no pasan por el mensaje principal.
--
-- `uso_mensual.costo_estimado_usd` solo sumaba el mensaje en sí (v89). Tres
-- llamadas a OpenAI corrían por fuera y no se contaban:
--
--   * la lectura de cada imagen (v197), para que "estos" funcione después;
--   * la transcripción de cada audio (Whisper);
--   * el clasificador de intención de los mensajes que los clientes le
--     escriben al WhatsApp de la empresa (CRM), a cuenta del dueño del canal.
--
-- En una cuenta que manda muchas fotos o audios el consumo real era mayor que
-- el registrado, y el aviso interno de los Gs. 70.000 (v201) llegaba tarde.
--
-- Suma plata y nada más: no toca `mensajes_usados`, porque ninguna de las
-- tres es un mensaje de la persona. Solo service_role.

create or replace function public.eos_sumar_costo_ia_v202(
  p_usuario_id uuid,
  p_costo_usd numeric
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  -- Una sola llamada no cuesta más de unos centavos. Un número fuera de rango
  -- es un error de quien llama, y sumarlo inflaría el consumo del mes.
  if p_usuario_id is null or p_costo_usd is null or p_costo_usd <= 0 or p_costo_usd > 5 then
    return false;
  end if;

  insert into public.uso_mensual (usuario_id, periodo, costo_estimado_usd)
  values (p_usuario_id, public.eos_periodo_actual(), p_costo_usd)
  on conflict (usuario_id, periodo) do update
    set costo_estimado_usd = public.uso_mensual.costo_estimado_usd + excluded.costo_estimado_usd,
        updated_at = now();

  return true;
end;
$$;

revoke all on function public.eos_sumar_costo_ia_v202(uuid, numeric) from public;
revoke all on function public.eos_sumar_costo_ia_v202(uuid, numeric) from anon, authenticated;

comment on function public.eos_sumar_costo_ia_v202(uuid, numeric) is
  'v202: suma al costo del mes lo que cuestan las llamadas al modelo que no son el mensaje (imágenes, audios, clasificador del CRM). No toca mensajes_usados. Solo service_role.';
