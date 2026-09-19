# Retención de datos: qué se borra, qué se conserva y qué queda por decidir

Estado al **19 de septiembre de 2026**, verificado contra la base de producción y el código de `main`, no contra la política publicada. Es el insumo para la revisión legal pendiente (punto 9 de la lista maestra): describe lo que el sistema HACE, para que quien lo revise no tenga que reconstruirlo.

## Cuando alguien elimina su cuenta

`POST /api/cuenta/eliminar` (frase de confirmación exacta) hace tres cosas en este orden:

1. **Tarjetas en Bancard.** Es el único dato fuera de nuestra base. Se intenta borrar cada una; si el proveedor falla, la baja sigue.
2. **Datos propios**, con `eos_borrar_mis_datos_v55()`: recorre el catálogo y borra de **toda** tabla del esquema `public` que tenga una columna `usuario_id` o `user_id` (117 tablas al día de hoy), más la fila de `usuarios`. Es dinámica a propósito: una lista fija de tablas queda vieja sin que nadie se entere. Falla fuerte si algo no se pudo borrar, y revierte todo.
3. **El acceso** (`auth.users`), por la API de administración.

### Qué se conserva

| Dato | Qué queda | Dónde | Por qué |
| --- | --- | --- | --- |
| Cobros de EOS **acreditados, reembolsados o revertidos** (`solicitudes_pago`, `historial_pagos`) | Nombre y correo de quien pagó **en el momento de borrar**, plan, periodicidad, monto, moneda, proveedor, referencias del cobro, estado y fechas. Sin el `metadata` libre. | `eos_registros_facturacion_conservados_v182`, sin columna `usuario_id`; enlazada a la cuenta solo por un hash (`cuenta_ref`). Solo `service_role` la lee. | La política publicada dice que se conservan "los registros de facturación que la ley nos obliga a mantener". Hasta la v182 el código los borraba (además tenían `on delete cascade`). |

### Qué se borra

Todo lo demás con `usuario_id`: conversaciones y mensajes, memorias y aprendizajes, documentos y sus hallazgos, movimientos y cuentas financieras, deudas, tarjetas propias, objetivos y tareas, ERP y CRM, decisiones, briefings, vínculos de WhatsApp, suscripciones push, el buzón de ingesta, la marca de tipo de cuenta, y **la bitácora de auditoría de esa cuenta** (decisión del dueño del producto, v167: el derecho a borrar "todos tus datos" no deja aparte el historial de lo que la persona hizo).

Las solicitudes de pago **pendientes, vencidas o rechazadas** también se borran: no son un cobro.

### Lo que la exportación incluye y no incluye

`GET /api/cuenta/exportar` devuelve un archivo con todo lo de esas mismas tablas, **sin credenciales** (claves `token`, `alias_token`, `secret`, `password`, `private_key`, `api_key`). No incluye la tabla de registros conservados: no es un dato que la persona haya cargado y solo existe después de haber borrado.

## Datos que viven fuera de nuestra base

| Dónde | Qué | Retención |
| --- | --- | --- |
| Resend | Correos recibidos en el buzón de ingesta | 30 días, plazo del proveedor; después se eliminan solos. El cuerpo de los avisos bancarios no se guarda en nuestra base. |
| Bancard | Tarjetas catastradas | Se borran al eliminar la cuenta (mejor esfuerzo). El número de tarjeta nunca llega a nuestros servidores. |
| Meta / WhatsApp | Mensajes del canal | Los rige Meta; nosotros guardamos la copia en `mensajes`, que se borra con la cuenta. |
| OpenAI | Texto enviado al modelo | Lo rige la política del proveedor; no hay un mecanismo nuestro para pedir el borrado por cuenta. |
| Supabase | Copias de seguridad | **PITR no está habilitado** y no hay copias físicas listas (punto 47). Las copias, cuando existan, contendrán datos borrados hasta que roten. |

## Lo que NO está decidido, y no es una decisión técnica

1. **Cuánto tiempo se conservan los registros de facturación.** La ley paraguaya fija un plazo para los comprobantes; no se inventó uno en el código. Hasta que se defina, se conservan sin vencimiento.
2. **Facturas electrónicas de quien usa el módulo de Facturación** (`eos_fe_documentos`, `eos_fe_secuencias`, `eos_fe_config`). Hoy hay 0 documentos y el módulo no está habilitado para emitir de verdad, así que no hay nada que perder. **Antes de activarlo:** eliminar la cuenta de un emisor borraría hoy sus documentos y **su numeración fiscal**, algo que el emisor tiene obligación de conservar y que no debería poder reutilizarse. Opciones a evaluar: impedir eliminar una cuenta con documentos emitidos hasta exportarlos, o conservarlos igual que los cobros.
3. **Si conservar el nombre y el correo de quien pagó es suficiente** para un registro de facturación (por ejemplo, si hace falta el RUC), o si sobra algún campo.
4. **Si la política de privacidad debe listar explícitamente** qué se conserva (hoy dice "los registros de facturación que la ley nos obliga a mantener", que ahora es cierto, pero no dice cuáles ni por cuánto tiempo).
5. **OpenAI:** si hace falta un acuerdo de no retención o un mecanismo de borrado por cuenta.

## Cómo se comprobó (19 de septiembre de 2026)

Con los datos reales de una cuenta con 16 registros de cobro (8 solicitudes y 8 del historial), dentro de una transacción que se revierte sola: se ejecutó `eos_borrar_mis_datos_v55()` con esa sesión y se comprobó que sus tablas de pago quedaban en 0, que la tabla de conservados tenía exactamente esos 16 registros con el correo del titular, que la cuenta desaparecía, que `anon` y `authenticated` no pueden leer la tabla nueva y que no tiene ninguna columna `usuario_id` ni `user_id`.
