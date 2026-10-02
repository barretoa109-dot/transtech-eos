# Comprensión, memoria y aprobación por WhatsApp — 01/10/2026 (tarde)

Sigue a `auditoria-cierre-2026-10-01.md`. Estado de partida comprobado, no
supuesto: producción en `cb338a0` (último main, `/api/version`), v228 en la base,
los 5 workflows vivos de n8n idénticos a main, sin PRs abiertos.

Todo lo que tocó producción fue lectura o transacción revertida con cuentas
sintéticas. No se conversó con el chat de producción, no se mandó ningún
WhatsApp, no se tocó ninguna cuenta real.

## Incidentes

| ID | Qué pasaba | Causa | Corrección | Prueba | Estado |
|---|---|---|---|---|---|
| INC-24 | "Mandale a Juan que ya llegó su pedido" pedía confirmación | gpt-5.5 agregaba texto que nadie dictó ("podés pasar a retirarlo") y por eso, con la regla de "texto que ella vio", preguntaba | Prompt: con a quién + qué en el mismo pedido, se manda con un saludo y lo dicho, sin agregar nada | QA: antes falla; después 2/2 corridas mandan "Hola, Juan. Ya llegó tu pedido." Sin texto dictado, propone y pregunta | CORREGIDO |
| INC-25 | Aprobar acciones por WhatsApp | No existía: la única salida era la web. En ago-sep vencieron 8 de 9 aprobaciones sin decidir (5 eran memorias que nunca se guardaron). Hoy aparecen cuando el día pasa 40 acciones o 240 puntos de riesgo | `lib/autonomia/resolver-aprobacion.ts` (la lógica del panel, compartida); `lib/whatsapp/aprobacion.ts` ("sí"/"no", o "sí 2" si hay varias, solo si lo último que mandó EOS fue el pedido de OK; resumen de la acción). El código de 6 dígitos del primer diseño se sacó el mismo día, a pedido del dueño: el número ya está vinculado; el webhook resuelve sin modelo ni cupo y cambia el enlace web por las instrucciones | 17 pruebas unitarias; `aprobacion_whatsapp_e2e.sql` **10/10** contra producción, revertida: otra cuenta no aprueba ni consume, el segundo SÍ no vuelve a aprobar, payload distinto no se ejecuta, no se consume dos veces, vencida no se ejecuta | CORREGIDO (falta un WhatsApp real: ver bloqueos) |
| INC-26 | "Me pasó 300 de lo que me debía" → "¿₲300 o ₲300.000?" | El prompt no tenía la convención local de montos | Regla "MONTOS COMO SE DICEN ACÁ" | QA: registra el cobro | CORREGIDO |
| INC-27 | "Anotá la venta… y recordame cobrarle el viernes" → creaba la tarea y RETENÍA la venta | Preguntaba si era a crédito y hacía la mitad del pedido | Cobrar después = crédito; un pedido mixto no se hace a medias | QA: venta + tarea | CORREGIDO |
| INC-28 | Audios: ninguna regla sobre transcripciones dudosas ("bristo", "tupi") | Faltaba | Un `[Audio]` es transcripción automática: usar el producto cargado si es claro y decirlo, preguntar si no | QA: "Entendí 3 pares de Zapato Bristol negro y 2 de Sandalia Tupí. ¿Fue a Doña Elsa o a Marcos Giménez?", sin registrar | CORREGIDO |
| INC-29 | La ruta de aprobaciones del panel tenía de respaldo una URL de preview vieja | Si faltaba `EOS_APP_BASE_URL`, ejecutaba contra un despliegue viejo | Respaldo = la app (`baseDeLaApp`) | prueba unitaria | CORREGIDO |

## Batería de lenguaje natural (`evals/qa/natural.ts`)

30 casos con lenguaje real, en ocho grupos: contar / consejo / registrar, faltas de ortografía, varios temas y montos, seguimientos y
referencias ("esa cuota", "el otro préstamo", "lo que te dije"), correcciones,
ambiguos (incluido el audio de los zapatos), finanzas (decimales, sueldo, captura
de EOS que no es operación nueva) y WhatsApp a clientes. Más los 6 de asesoría y
regresión de `casos.ts`. Cada caso mide verbos y, cuando importa, qué tiene que
decir o no decir.

| Corrida | Resultado |
|---|---|
| Primera, prompt de main, ruteo de producción | 25/30 (2 de las 5 fallas eran expectativas mías mal escritas: cambiar el cliente es anular + registrar por diseño; la respuesta usó "cuota" en vez de "préstamo") |
| Final, prompt nuevo, ruteo de producción, los 36 | **36/36** |

El criterio no es solo "no inventar": en los mismos casos tiene que actuar (venta
con faltas de ortografía, "esa cuota" → el pago correcto, "el otro préstamo" →
la moto) y preguntar UNA cosa cuando falta (qué tarjeta, a qué clienta, vendió o compró).

## Memoria entre turnos (`supabase/pruebas/memoria_e2e.sql`) — 9/9 contra producción, revertida

Escrita con el ejecutor del chat y leída con la consulta del turno siguiente:
se guarda aunque la importancia venga como texto; el turno siguiente la trae; un
reintento no duplica; una corrección reemplaza el dato y guarda el anterior;
otra persona no la ve (ni por el servidor ni con su sesión); sin autorización no
se escribe; lo archivado no se revive.

## Finanzas y caso Green — contra producción, revertidas, con las migraciones vivas

`finanzas_no_repite_e2e` 17/17, `pago_tarjeta_sin_monto_e2e` 3/3,
`venta_cliente_nuevo_e2e` 7/7. En la batería: pago con decimales, "ya pagué el
mínimo" sin monto pregunta, captura de EOS no es operación nueva, dos tarjetas →
pregunta cuál.

## Archivos

- Excel de `/descargar` bajado de producción: 200, `.xlsx` válido (PK), 9 hojas.
- Documentos a pedido: `lib/documentos/renderizar.test.ts` dibuja el mismo plan
  en Excel, PDF y Word y comprueba la firma del archivo (5/5); una
  especificación dañada no se entrega.
- Enlace del Excel por WhatsApp sin duplicar (INC-22, ronda anterior).

## Confirmaciones verdaderas

La confirmación sale de lo que devuelve la función de la base al escribir (id del
efecto, en la misma transacción), no del texto del modelo
(`lib/eos/verificacion.ts`); sin evidencia se dice que no se pudo confirmar
(`acciones-chat.ts`). Producción, últimos 7 días: 0 reservas colgadas.

## Gasto con modelos (tope US$ 1)

| Corrida | Llamadas | USD |
|---|---|---|
| Natural, primera pasada | 30 | 0,235 |
| Fallas y vecinos, prompt nuevo | 10 | 0,133 |
| WhatsApp (INC-24) | 2 | 0,029 |
| Final completa (36 casos) | 36 | 0,330 |
| **Total** | **78** | **≈ 0,73** |

gpt-6-sol para lo rutinario y gpt-5.5 donde el ruteo de producción lo manda
(varias operaciones, cartera, WhatsApp). Modelo efectivo comprobado en cada
respuesta. Detalle: `evals/qa/resultados/20261001*`.

## Bloqueado (no se marca como resuelto)

| Qué | Por qué | Quién | Cómo |
|---|---|---|---|
| Aprobación por WhatsApp de punta a punta | Exige mandar y recibir WhatsApp reales | Dueño, con su número vinculado | Configurar una regla de autonomía nivel 2 para CREAR_TAREA en /eos/autonomy, escribir "recordame llamar al proveedor mañana" por WhatsApp, contestar "sí" y ver la tarea en Calendario; repetir contestando "no" |
| Micrófono en iPhone y Android | Dispositivos físicos | Dueño | Negar permiso, cancelar, dejar vencer y volver a escribir en cada uno |
| Caso Green por el chat real con cuenta QA | Las reglas prohíben conversar con producción desde una sesión | Dueño | "Gasté 46.000 en Punto Farma con la Green, ya pagué el mínimo, y gané 100.000" → compra + ingreso, sin pago |
| `certificar 3 6 11` | Tarjeta de prueba de Bancard | Dueño | `npm run certificar -- 3 6 11` |
| Igualar "comparable a ChatGPT y Claude" | 36/36 en esta batería no lo demuestra en general: es una muestra de 36 casos | — | Sumar casos reales a `natural.ts` cada vez que aparezca un error en el uso |

## Rollback

- Prompt: el parche deja respaldo del gateway en `n8n/respaldos/`; PUT de ese
  archivo + `git revert` (TS y n8n vuelven juntos).
- Aprobación por WhatsApp: `git revert`; sin migraciones. Sin
  `EOS_WORKER_GATE_SECRET` se apaga sola (el enlace a la web vuelve).
- Panel de aprobaciones: `git revert` devuelve la ruta anterior.
