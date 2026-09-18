-- v175: el aviso proactivo de "se te acaba el stock" (proyección por ritmo de ventas).
--
-- `lib/erp/agotamiento.ts` proyecta cuándo se agota un producto según sus
-- salidas de los últimos 30 días, y `detectarRiesgosNegocio` lo devuelve como
-- un tipo nuevo: `stock_por_agotarse`.
--
-- El cron de avisos (`lib/erp/avisar-negocio.ts`) guarda el último aviso de
-- cada tipo en `eos_negocio_avisos` para no repetirlo. Ese `tipo` tiene un
-- check con la lista cerrada, así que sin ampliarlo el `upsert` fallaría DESPUÉS
-- de haber entregado el aviso: no quedaría registrado y se repetiría todos los
-- días.
--
-- ORDEN: esta migración se aplica ANTES de desplegar el código que emite el
-- tipo nuevo. Al revés, la primera corrida del cron avisa y no puede anotarlo.

alter table public.eos_negocio_avisos
  drop constraint if exists eos_negocio_avisos_tipo_check;

alter table public.eos_negocio_avisos
  add constraint eos_negocio_avisos_tipo_check
  check (tipo in ('inventario_bajo', 'cobros_demorados', 'gasto_anormal', 'stock_por_agotarse'));
