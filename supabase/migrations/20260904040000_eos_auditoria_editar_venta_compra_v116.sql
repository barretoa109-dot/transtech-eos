-- v116 (bis) · La bitácora admite "venta_editada" y "compra_editada".
--
-- Va aparte de la migración que crea eos_erp_editar_venta/compra porque esa
-- ya se aplicó al remoto antes de que esta restricción se agregara: editar un
-- archivo ya aplicado no lo vuelve a correr, solo desincroniza el repo de lo
-- que la base realmente tiene. Corresponde una migración nueva hacia
-- adelante, no reescribir la anterior.

alter table public.eos_auditoria_v60
  drop constraint if exists eos_auditoria_v60_evento_check;

alter table public.eos_auditoria_v60
  add constraint eos_auditoria_v60_evento_check
  check (evento = any (array[
    'correo_recibido', 'movimiento_ingerido', 'movimiento_descartado',
    'movimiento_confirmado', 'accion_autorizada', 'accion_rechazada',
    'datos_exportados', 'conciliacion_registrada',
    'venta_registrada', 'venta_cobrada', 'venta_anulada', 'venta_editada',
    'compra_registrada', 'compra_pagada', 'compra_anulada', 'compra_editada',
    'stock_ajustado', 'producto_modificado', 'comprobante_emitido',
    'costo_corregido'
  ]));
