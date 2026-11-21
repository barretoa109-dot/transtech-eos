-- v266: plan Emprendedor Inicial, Gs. 70.000, para el micronegocio de una persona.
--
-- ============================================================
-- POR QUÉ
-- ============================================================
--
-- En la ronda 3 de la simulación de 100 clientes (21/11/2026), el grupo más
-- grande que no compraba eran ocho micronegocios con presupuesto de Gs. 60.000
-- a 80.000: panadería, pastelería, comedor, tortas, fletes, hospedaje,
-- lavadero, comida congelada. Emprendedor (Gs. 100.000) les queda grande, y
-- Finanzas Personales no carga gastos del negocio (v263). El dueño pidió un
-- plan de entrada a Gs. 70.000.
--
-- ============================================================
-- QUÉ TRAE Y QUÉ NO
-- ============================================================
--
-- Trae lo que usa una persona sola con su negocio: hablar con EOS, ventas,
-- compras, stock, clientes y cobros del ERP, panel, resumen diario,
-- decisiones y documentos.
--
-- No trae lo que hace a un negocio con equipo, que es lo que justifica
-- Emprendedor: el CRM (oportunidades, seguimientos, WhatsApp a clientes), los
-- comprobantes y **sumar gente que trabaje en la empresa**. Para eso nace el
-- módulo `equipo`. Sin él, un negocio con cinco vendedores pagaría Gs. 70.000
-- en lugar de 100.000.
--
-- El contador SÍ entra: invitar a alguien como Contabilidad o Solo lectura no
-- pide `equipo` (ver `app/api/empresa/miembros/route.ts`). Es el canal de los
-- contadores de la v265 y no se lo corta al plan más chico.
--
-- ============================================================
-- QUE NADIE PIERDA LO QUE YA TIENE
-- ============================================================
--
-- * Toda cuenta con el ERP activo recibe `equipo` con el mismo origen y el
--   mismo vencimiento.
-- * Emprendedor y Full suman `equipo`, así la prueba de un mes (v264, que lee
--   el plan `full`) también lo trae.
-- * Los armados vigentes o pendientes que tienen el ERP suman `equipo`: la
--   renovación vuelve a activar la lista guardada, y sin esto el equipo de un
--   cliente que ya paga se apagaría al renovar.
-- * Los miembros que ya están en una empresa siguen igual: `equipo` solo se
--   pide para invitar o para pasar a alguien a un rol de trabajo.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   update public.eos_paquetes set activo = false where codigo = 'inicial';
--   (el módulo `equipo` puede quedar: sin él en el catálogo, la ruta deja
--   invitar a todos, como antes)

-- ============================================================
-- 1) El módulo `equipo`
-- ============================================================

insert into public.eos_modulos (
  codigo, nombre, descripcion, precio_mensual_pyg, precio_anual_pyg,
  grupo, limite_mensajes, requiere, plan_equivalente, activo, es_publico, orden
) values (
  'equipo', 'Usuarios para tu equipo',
  'Sumá a la gente que trabaja en tu negocio, cada una con su rol.',
  0, 0, null, null, '{erp}', null, true, false, 95
)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  requiere = excluded.requiere,
  activo = true;

-- Quien ya tiene el ERP, ya tiene equipo: mismo origen, mismo vencimiento.
insert into public.eos_usuario_modulos (
  usuario_id, modulo_codigo, estado, inicio, vencimiento, origen, referencia_pago, notas
)
select um.usuario_id, 'equipo', um.estado, um.inicio, um.vencimiento, um.origen,
       um.referencia_pago, 'Dado con el ERP al crear el plan Inicial (v266)'
from public.eos_usuario_modulos um
where um.modulo_codigo = 'erp'
on conflict (usuario_id, modulo_codigo) do nothing;

-- ============================================================
-- 2) Los planes
-- ============================================================

update public.eos_paquetes
set modulos = modulos || array['equipo']
where codigo in ('emprendedor', 'full')
  and not ('equipo' = any(modulos));

insert into public.eos_paquetes
  (codigo, nombre, descripcion, modulos, precio_mensual_pyg, precio_anual_pyg, orden)
values
  ('inicial', 'Emprendedor Inicial',
   'Tu negocio, si lo llevás vos sola o vos solo: ventas, compras, stock y cobros hablando o por audio.',
   array['conversaciones_full', 'dashboard', 'erp', 'briefing', 'decisiones', 'documentos'],
   70000, 700000, 15)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  modulos = excluded.modulos,
  precio_mensual_pyg = excluded.precio_mensual_pyg,
  precio_anual_pyg = excluded.precio_anual_pyg,
  orden = excluded.orden,
  activo = true;

alter table public.eos_planes_armados
  drop constraint if exists eos_planes_armados_paquete_chk;

alter table public.eos_planes_armados
  add constraint eos_planes_armados_paquete_chk
  check (paquete is null or paquete in ('finanzas_personales', 'inicial', 'emprendedor', 'full'));

-- Las compras que ya traen el ERP renuevan también el equipo.
update public.eos_planes_armados
set modulos = modulos || array['equipo'],
    actualizado_en = now()
where estado in ('vigente', 'pendiente')
  and 'erp' = any(modulos)
  and not ('equipo' = any(modulos))
  and coalesce(paquete, '') <> 'inicial';
