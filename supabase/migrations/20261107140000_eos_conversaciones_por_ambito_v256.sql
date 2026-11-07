-- El historial de chat, separado entre Personal y el negocio (v256).
--
-- ============================================================
-- EL PROBLEMA
-- ============================================================
--
-- `conversaciones` solo tiene `usuario_id`: la lista de chats de la barra
-- lateral se arma con un único select por usuario, sin mirar en qué espacio
-- se está. El resultado es el que reportó el dueño: el mismo historial
-- aparece en Personal y en Mi negocio, aunque los dos espacios ya separan
-- todo lo demás (plata, menú, fijos) desde la v136.
--
-- ============================================================
-- LA SOLUCIÓN: EL MISMO PATRÓN DE LA v136
-- ============================================================
--
-- `ambito`, default 'personal' — lo que no se declaró explícitamente queda
-- del lado de la persona, igual que un movimiento financiero o un fijo sin
-- ámbito. Las conversaciones que ya existen (incluidas las de WhatsApp, que
-- no conocen espacios) quedan en Personal: es el default seguro, no una
-- clasificación real, y así no desaparecen de la vista de nadie.
--
-- No lleva `empresa_id`: el chat, igual que los movimientos financieros y
-- los fijos, es una tabla por USUARIO que cruza los dos espacios, no una
-- tabla de ERP/CRM por empresa (v110).

alter table public.conversaciones
  add column if not exists ambito text not null default 'personal';

alter table public.conversaciones
  drop constraint if exists eos_conversaciones_ambito_check;

alter table public.conversaciones
  add constraint eos_conversaciones_ambito_check
  check (ambito in ('negocio', 'personal'));

-- La barra lateral filtra por usuario + ámbito en cada carga, ordenado por
-- fecha: el índice va por ahí, no por usuario solo.
create index if not exists eos_conversaciones_ambito_idx
  on public.conversaciones (usuario_id, ambito, created_at desc);

comment on column public.conversaciones.ambito is
  'v256: separa el historial de chat entre Personal y el negocio. Default personal (lado seguro para lo que ya existía, incluido WhatsApp).';
