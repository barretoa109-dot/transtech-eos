-- El ámbito llega a las cuentas y a las deudas.
--
-- ============================================================
-- LA MEZCLA QUE QUEDÓ ABIERTA EN LA v136
-- ============================================================
--
-- La v136 separó la plata del negocio de la plata de la persona en las dos
-- tablas que recibían las dos cosas: los movimientos y los fijos. Quedaron
-- afuera `eos_finanzas_cuentas` y `eos_finanzas_deudas`, y en ese momento
-- parecía correcto: las dos se cargan desde Personal.
--
-- No lo era. `app/api/contabilidad/route.ts` —la POSICIÓN DEL NEGOCIO— lee
-- `eos_finanzas_deudas` sin filtro alguno. Su propio comentario dice que "las
-- deudas son declaradas por la persona y viven del lado personal", y aun así
-- las suma al pasivo corriente de la empresa.
--
-- El efecto es concreto: el préstamo del auto de alguien baja el capital de
-- trabajo de su negocio y empeora su liquidez corriente. Los dos números
-- siguen pareciendo números. Y es justo la clase de error que este proyecto ya
-- vio una vez, cuando ₲ 2.638.000 de lechones aterrizaron en el panel de
-- finanzas personales.
--
-- Ahora que el patrimonio va a calcularse como ACTIVOS − PASIVOS, la pregunta
-- "¿de quién es este pasivo?" deja de ser prolijidad y pasa a decidir un
-- número que alguien va a leer.
--
-- ============================================================
-- EL DEFAULT ES 'personal', Y EL BACKFILL TAMBIÉN
-- ============================================================
--
-- Las dos tablas se cargan hoy por dos vías, y las dos son de la persona: los
-- formularios de Personal (`FinanzasCuentas`, `FinanzasDeudas`) y la acción de
-- chat `REGISTRAR_DEUDA`, cuyo prompt dice con todas las letras "lo que la
-- persona DEBE". No hay ninguna vía que escriba deudas del negocio.
--
-- Así que backfillear todo a 'personal' no es una suposición: es lo que ya
-- son. Lo que cambia es que la posición del negocio deja de tomarlas
-- prestadas, y pasa a decir que no tiene pasivos de deuda cargados — que es la
-- verdad, y es lo que habilita cargarlos.

-- ============================================================
-- 1) La columna
-- ============================================================

alter table public.eos_finanzas_cuentas
  add column if not exists ambito text not null default 'personal';

alter table public.eos_finanzas_cuentas
  drop constraint if exists eos_cuentas_ambito_check;

alter table public.eos_finanzas_cuentas
  add constraint eos_cuentas_ambito_check
  check (ambito in ('negocio', 'personal'));

alter table public.eos_finanzas_deudas
  add column if not exists ambito text not null default 'personal';

alter table public.eos_finanzas_deudas
  drop constraint if exists eos_deudas_ambito_check;

alter table public.eos_finanzas_deudas
  add constraint eos_deudas_ambito_check
  check (ambito in ('negocio', 'personal'));

comment on column public.eos_finanzas_cuentas.ambito is
  'De quién es esta cuenta: del negocio o de la persona. Nunca se suman entre sí.';

comment on column public.eos_finanzas_deudas.ambito is
  'De quién es esta deuda. La posición del negocio solo cuenta las suyas; el patrimonio personal, las de la persona.';

-- Los dos paneles filtran por ámbito en cada consulta.
create index if not exists eos_cuentas_ambito_idx
  on public.eos_finanzas_cuentas (usuario_id, ambito) where activa;

create index if not exists eos_deudas_ambito_idx
  on public.eos_finanzas_deudas (usuario_id, ambito) where estado <> 'saldada';

-- ============================================================
-- 2) Lo que ya está cargado es de la persona
-- ============================================================
--
-- Explícito aunque el default lo cubra: `add column ... default` ya rellena
-- las filas existentes, pero dejarlo escrito hace que la intención sobreviva
-- a la próxima lectura de este archivo.

update public.eos_finanzas_cuentas set ambito = 'personal' where ambito is null;
update public.eos_finanzas_deudas set ambito = 'personal' where ambito is null;

-- ============================================================
-- 3) Que la acción de chat siga escribiendo del lado correcto
-- ============================================================
--
-- `eos_finanzas_registrar_deuda_v139` inserta sin nombrar la columna, así que
-- toma el default 'personal'. Es lo que corresponde: el prompt de
-- REGISTRAR_DEUDA describe deuda de la persona. Queda anotado acá para que
-- quien agregue mañana una deuda del negocio sepa que tiene que decirlo.

comment on function public.eos_finanzas_registrar_deuda_v139(uuid, uuid, jsonb) is
  'Crea o actualiza una deuda DE LA PERSONA. Toma ambito=personal por default; una deuda del negocio tendría que declararlo.';
