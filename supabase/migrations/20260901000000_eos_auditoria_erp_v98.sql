-- Que las operaciones del ERP también queden asentadas (v98).
--
-- ============================================================
-- LA BITÁCORA MIRABA PARA EL OTRO LADO
-- ============================================================
--
-- `eos_auditoria_v60` es una bitácora append-only, encadenada por hash y con
-- una función que verifica la cadena entera. Está muy bien hecha. Y su lista
-- de eventos cubre exactamente dos cosas: la ingesta de datos —por dónde entra
-- la plata— y las acciones que el usuario le autorizó a EOS.
--
-- No cubre nada de lo que el usuario hace él mismo en el negocio. Registrar
-- una venta, cobrarla, anularla, ajustar un stock, cambiar el costo de un
-- producto, emitir un comprobante: ninguna de las nueve operaciones sensibles
-- del ERP dejaba una línea acá.
--
-- Eso es justo lo que se necesita el día que un saldo de stock no cierra, o
-- que alguien pregunta por qué el costo de un producto cambió el martes, o que
-- un cliente jura haber anulado una venta que sigue viva. Sin registro, la
-- respuesta es "no se puede saber".
--
-- ============================================================
-- POR QUÉ NO SE AGREGAN COLUMNAS
-- ============================================================
--
-- El punto 42 pide valores anteriores y nuevos, motivo y resultado. Lo natural
-- sería agregar cuatro columnas. No se hace, y el motivo importa:
--
-- El hash de cada eslabón se calcula sobre `numero`, `usuario_id`, `evento`,
-- `origen`, `resumen`, `detalle`, `referencia`, `created_at` y `hash_previo`.
-- Una columna nueva quedaría FUERA del hash, o sea sin proteger — el antes y
-- el después, que es lo más delicado del registro, se podría reescribir sin
-- romper la cadena. Y meterla adentro del hash cambiaría la función y dejaría
-- inválidas todas las filas ya escritas.
--
-- Así que van dentro de `detalle`, que sí está hasheado, con una forma fija que
-- impone `registrarOperacionErp` en `lib/auditoria/registrar.ts`. Un objeto en
-- vez de una columna es peor para consultar y mucho mejor para confiar.
--
-- ============================================================
-- LO QUE NO ESTÁ, Y CUÁNDO VA A ESTAR
-- ============================================================
--
-- El punto 42 también pide empresa y sucursal. Todavía no existen: el tenant
-- es `usuario_id` hasta la fase 1 del ERP profesional. Cuando existan, se
-- agregan al `detalle` de la misma forma y sin tocar el hash.

alter table public.eos_auditoria_v60
  drop constraint if exists eos_auditoria_v60_evento_check;

alter table public.eos_auditoria_v60
  add constraint eos_auditoria_v60_evento_check
  check (evento in (
    -- Ingesta de datos
    'correo_recibido',
    'movimiento_ingerido',
    'movimiento_descartado',
    'movimiento_confirmado',
    -- Acciones autorizadas
    'accion_autorizada',
    'accion_rechazada',
    -- Datos del usuario
    'datos_exportados',
    'conciliacion_registrada',
    -- Operaciones del negocio (v98)
    'venta_registrada',
    'venta_cobrada',
    'venta_anulada',
    'compra_registrada',
    'compra_pagada',
    'compra_anulada',
    'stock_ajustado',
    'producto_modificado',
    'comprobante_emitido'
  ));

comment on constraint eos_auditoria_v60_evento_check on public.eos_auditoria_v60 is
  'v98: se suman las nueve operaciones sensibles del ERP. Los valores antes/después, el motivo y el resultado viajan dentro de `detalle`, que está hasheado; una columna nueva quedaría fuera de la cadena.';
