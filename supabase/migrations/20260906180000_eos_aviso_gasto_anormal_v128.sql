-- El tercer aviso del punto 20.
--
-- `eos_negocio_avisos` guarda el último aviso de cada tipo para no repetir el
-- mismo problema todos los días, y su `check` enumera los tipos que existen.
-- Con dos, la enumeración era una lista corta; con el tercero es lo que impide
-- que el cron inserte una fila y falle en silencio.
--
-- El tipo nuevo es `gasto_anormal`: un gasto que no se parece a nada de lo que
-- esa persona viene gastando en esa categoría. Las cinco condiciones que tiene
-- que cumplir —y por qué la compra anual del seguro deja de avisarse a partir
-- del segundo año— están en `lib/erp/gasto-anormal.ts`, con sus casos.
--
-- Se agrega el valor y nada más. La tabla, sus políticas y el borrado del aviso
-- cuando el problema se resuelve ya funcionan igual para los tres.

alter table public.eos_negocio_avisos
  drop constraint if exists eos_negocio_avisos_tipo_check;

alter table public.eos_negocio_avisos
  add constraint eos_negocio_avisos_tipo_check
  check (tipo in ('inventario_bajo', 'cobros_demorados', 'gasto_anormal'));

comment on column public.eos_negocio_avisos.clave is
  'Qué compone el riesgo, para no repetirlo: los ids de los productos que faltan, de las ventas demoradas, o de los movimientos que salieron de lo habitual. Si la clave cambia, el problema cambió y se vuelve a avisar.';
