-- Las dos cuentas del dueño dejan de contar como clientes.
--
-- Pedido del dueño (26/09/2026): `npm run piloto` las listaba como cuentas
-- reales —una hasta le pedía que se contactara a sí mismo— y entraban en las
-- métricas de activación, conversión y consumo. Se marcan igual que la v172
-- marcó la cuenta demo y la del arnés de QA.
--
-- Efecto que hay que saber: el briefing diario se genera solo para cuentas
-- reales (v174), así que estas dos dejan de recibirlo. El aviso interno de
-- consumo (v201) tampoco las mira. Todo lo demás —chat, módulos, plan— sigue
-- igual. Para volver atrás: borrar sus filas de `eos_cuenta_tipo_v172`.

insert into public.eos_cuenta_tipo_v172 (usuario_id, tipo, motivo)
select a.id, 'interna', 'cuenta del dueño (pedido del 26/09/2026)'
from auth.users a
where lower(a.email) in ('barretoa109@gmail.com', 'galeanoaugusto05@gmail.com')
on conflict (usuario_id) do update
  set tipo = excluded.tipo,
      motivo = excluded.motivo,
      marcado_en = now();
