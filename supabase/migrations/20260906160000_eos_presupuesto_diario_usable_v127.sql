-- Una venta por día y después EOS decía que no.
--
-- ============================================================
-- LA CUENTA QUE NADIE HIZO
-- ============================================================
--
-- El perfil de autonomía trae dos techos diarios, puestos en la v12 cuando las
-- únicas acciones que existían eran crear una tarea, un objetivo y guardar
-- memoria:
--
--   max_auto_actions_per_day = 5
--   max_daily_risk_points    = 10
--
-- La v83 sumó las tres acciones del negocio, y `SYSTEM_RISK` en
-- `lib/worker-gate-handler.ts` les puso el riesgo que corresponde a lo que
-- tocan:
--
--   REGISTRAR_VENTA   6 puntos
--   AJUSTAR_STOCK     6 puntos
--   CREAR_CONTACTO    3 puntos
--
-- Seis contra un presupuesto de diez. La primera venta del día pasa y deja el
-- presupuesto en 6; la segunda pide otros 6, llega a 12, y la puerta responde:
--
--   decision = 'block'
--   "La acción superaría el presupuesto diario de riesgo automático."
--
-- `block`, no `approval`: ni siquiera queda una aprobación pendiente que la
-- persona pueda destrabar. **La segunda venta del día simplemente no entra**, y
-- desde el chat eso se ve como que EOS no registra nada en el ERP. Que es,
-- textual, lo que se reportó desde el uso real.
--
-- Peor: una venta gasta el 60% del presupuesto, así que después de UNA venta
-- casi nada más entra tampoco — ni una tarea, ni un contacto.
--
-- ============================================================
-- POR QUÉ SE SUBE Y NO SE SACA
-- ============================================================
--
-- El techo no está para pedir permiso: para eso está el nivel de autonomía,
-- que el usuario ya configuró y que para estas tres acciones dice "sin
-- excepción". El techo está para que un modelo trabado repitiendo una acción
-- se detenga en algún lado. Eso sigue haciendo falta y por eso sigue existiendo.
--
-- Los números nuevos salen de la única cuenta que importa: cuántas de estas
-- acciones hace en un día alguien que usa el chat en serio. Cargar unas
-- quince ventas por chat, agendar tres clientes y ajustar dos veces el stock
-- es un día cargado y da 15×6 + 3×3 + 2×6 = 111 puntos en 20 acciones.
--
--   max_auto_actions_per_day = 40   (el doble de ese día cargado)
--   max_daily_risk_points    = 240  (el doble también, y el tope duro
--                                    de la tabla es 1000)
--
-- Con 40 acciones, un modelo en bucle se frena antes de la mitad de una hora
-- de uso normal, que es para lo que el techo sirve. Con 240 puntos, quien
-- carga su día de trabajo por chat nunca se topa con el techo, que es lo que
-- hoy no pasa.
--
-- El chat no es la vía para cargar cientos de ventas: para eso está la pantalla
-- del ERP, que no pasa por esta puerta. Este techo tiene que alcanzar para un
-- día de uso conversacional, no para reemplazar un punto de venta.
--
-- ============================================================
-- LOS DOS LUGARES QUE TIENEN QUE DECIR LO MISMO
-- ============================================================
--
-- `DEFAULT_PROFILE` en `lib/worker-gate-handler.ts` repite estos valores para
-- los usuarios que todavía no tienen fila propia. Ya se desincronizaron una
-- vez: cinco de los seis usuarios de producción corrieron catorce días en un
-- nivel que ni ejecutaba ni preguntaba mientras el chat les decía que sí. Si
-- cambia uno, cambia el otro, y este commit cambia los dos.

alter table public.eos_autonomy_profiles_v12
  alter column max_auto_actions_per_day set default 40;

alter table public.eos_autonomy_profiles_v12
  alter column max_daily_risk_points set default 240;

-- ============================================================
-- Las filas que ya existen
-- ============================================================
--
-- Se suben SOLO las que están en el valor viejo por defecto. Si alguien bajó
-- su propio techo a mano, esa decisión es suya y esta migración no la pisa: el
-- bug era el default, no la configuración de quien la tocó.

update public.eos_autonomy_profiles_v12
set max_auto_actions_per_day = 40,
    updated_at = now()
where max_auto_actions_per_day = 5;

update public.eos_autonomy_profiles_v12
set max_daily_risk_points = 240,
    updated_at = now()
where max_daily_risk_points = 10;

comment on column public.eos_autonomy_profiles_v12.max_daily_risk_points is
  'Presupuesto diario de riesgo para las acciones automáticas. Es un freno contra un modelo en bucle, no un pedido de permiso: superarlo BLOQUEA, no abre una aprobación. Tiene que alcanzar para un día de uso conversacional — ver v127.';

comment on column public.eos_autonomy_profiles_v12.max_auto_actions_per_day is
  'Acciones automáticas por día. Mismo criterio que max_daily_risk_points: freno, no permiso. Ver v127.';
