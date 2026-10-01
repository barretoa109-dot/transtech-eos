# QA con tope — natural · ruteo de producción (2026-10-01)

Modelo: el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5), razonamiento `low`, `max_output_tokens` 1200, tope US$ 0.6. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| nat-solo-cuenta | `gpt-6-sol` → `gpt-6-sol` | — | 11760 / 0 / 35 | 0.02387 | OK |
| nat-consejo-precio | `gpt-6-sol` → `gpt-6-sol` | — | 11759 / 11480 / 84 | 0.00369 | OK |
| nat-hipotetico | `gpt-6-sol` → `gpt-6-sol` | — | 11762 / 11480 / 78 | 0.00364 | OK |
| nat-pensando-comprar | `gpt-6-sol` → `gpt-6-sol` | — | 11759 / 11480 / 100 | 0.00385 | OK |
| nat-venta-nomas | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA | 11755 / 11480 / 93 | 0.00378 | OK |
| nat-typo-venta | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA | 11762 / 11480 / 111 | 0.00397 | OK |
| nat-typo-compra | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_COMPRA | 11761 / 11480 / 116 | 0.00402 | OK |
| nat-sin-tildes-cobro | `gpt-6-sol` → `gpt-6-sol` | — | 11757 / 11480 / 62 | 0.00347 | FALLA: esperaba REGISTRAR_COBRO, vino nada |
| nat-venta-y-cobro | `gpt-5.5` → `gpt-5.5-2026-04-23` | REGISTRAR_VENTA + REGISTRAR_COBRO | 11773 / 0 / 246 | 0.06624 | OK |
| nat-tres-cosas | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_COMPRA + REGISTRAR_COMPRA + REGISTRAR_VENTA | 11779 / 11480 / 199 | 0.00488 | OK |
| nat-venta-y-recordatorio | `gpt-6-sol` → `gpt-6-sol` | CREAR_TAREA | 11765 / 11480 / 106 | 0.00393 | FALLA: esperaba CREAR_TAREA+REGISTRAR_VENTA, vino CREAR_TAREA |
| nat-producto-y-venta | `gpt-5.5` → `gpt-5.5-2026-04-23` | CREAR_PRODUCTO + REGISTRAR_VENTA | 11771 / 11008 / 237 | 0.01643 | OK |
| nat-otras-iguales | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA | 11801 / 11480 / 95 | 0.00389 | OK |
| nat-esa-cuota | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_PAGO_DEUDA | 11776 / 11480 / 72 | 0.00361 | OK |
| nat-el-otro | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_PAGO_DEUDA | 11778 / 11480 / 95 | 0.00384 | OK |
| nat-lo-que-te-dije | `gpt-6-sol` → `gpt-6-sol` | — | 11782 / 11480 / 175 | 0.00465 | FALLA: no dice /pr[eé]stamo/ |
| nat-corrige-cliente | `gpt-6-sol` → `gpt-6-sol` | ANULAR_VENTA + REGISTRAR_VENTA | 11804 / 11480 / 162 | 0.00456 | FALLA: esperaba CORREGIR_VENTA, vino ANULAR_VENTA+REGISTRAR_VENTA; prohibido: REGISTRAR_VENTA |
| nat-corrige-compra | `gpt-6-sol` → `gpt-6-sol` | CORREGIR_COMPRA | 11794 / 11480 / 52 | 0.00344 | OK |
| nat-corrige-y-agrega | `gpt-6-sol` → `gpt-6-sol` | CORREGIR_VENTA + REGISTRAR_VENTA | 11807 / 11480 / 129 | 0.00424 | OK |
| nat-audio-zapatos | `gpt-6-sol` → `gpt-6-sol` | — | 11750 / 11480 / 127 | 0.00411 | OK |
| nat-sin-producto | `gpt-6-sol` → `gpt-6-sol` | — | 11751 / 11480 / 108 | 0.00392 | OK |
| nat-venta-o-compra | `gpt-6-sol` → `gpt-6-sol` | — | 11754 / 11480 / 63 | 0.00347 | OK |
| nat-me-pagaron | `gpt-5.5` → `gpt-5.5-2026-04-23` | — | 11749 / 11008 / 109 | 0.01248 | OK |
| nat-tarjeta-cual | `gpt-6-sol` → `gpt-6-sol` | — | 11700 / 11480 / 71 | 0.00345 | OK |
| nat-monto-raro | `gpt-6-sol` → `gpt-6-sol` | — | 11755 / 11480 / 69 | 0.00354 | OK |
| nat-pago-decimales | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_PAGO_DEUDA | 11781 / 11480 / 94 | 0.00384 | OK |
| nat-sueldo | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_MOVIMIENTO_PERSONAL | 11753 / 11480 / 94 | 0.00378 | OK |
| nat-captura-no-es-nueva | `gpt-6-sol` → `gpt-6-sol` | — | 11806 / 11480 / 70 | 0.00365 | OK |
| nat-wa-dictado | `gpt-5.5` → `gpt-5.5-2026-04-23` | — | 11755 / 11008 / 80 | 0.01164 | FALLA: esperaba ENVIAR_WHATSAPP_CLIENTE, vino nada |
| nat-wa-sin-texto | `gpt-5.5` → `gpt-5.5-2026-04-23` | — | 11752 / 11008 / 77 | 0.01153 | OK |

**25/30 · 30 llamadas · US$ 0.23541**

## Respuestas

### nat-solo-cuenta (`gpt-6-sol`)

> Qué bajón. Si querés, contame qué vendiste hoy y cuánto, y vemos cómo cerró el día.

### nat-consejo-precio (`gpt-6-sol`)

> Lo vendés a ₲180.000 y te cuesta ₲140.000: te deja ₲40.000 por bolsa, un margen bruto del 22,2%. Podrías probar una suba moderada, pero antes miraría cuánto cobra la competencia y si tus clientes aceptarían el cambio. ¿Tenés algún precio nuevo en mente?

### nat-hipotetico (`gpt-6-sol`)

> Si mañana vendés 10 bolsas de balanceado a ₲180.000 cada una, la ganancia bruta sería ₲400.000: ₲40.000 por bolsa, antes de otros gastos.

### nat-pensando-comprar (`gpt-6-sol`)

> ¿Son 20 bolsas de balanceado o de harina? Si todavía estás evaluando la compra a Agro Sur, puedo ayudarte a calcular cuánto te costaría cuando tengas el precio.

### nat-venta-nomas (`gpt-6-sol`)

> Venta de 2 Balanceados hoy, al precio de catálogo de ₲180.000 cada uno.

### nat-typo-venta (`gpt-6-sol`)

> Venta de 3 Harinas a Ña Rosa, a ₲60.000 cada una (₲180.000 en total).

### nat-typo-compra (`gpt-6-sol`)

> Compra de 10 bolsas de Balanceado a ₲140.000 cada una, a Agro Sur.

### nat-sin-tildes-cobro (`gpt-6-sol`)

> ¿Juan Pérez te pasó ₲300 o ₲300.000?

### nat-venta-y-cobro (`gpt-5.5`)

> Venta a Juan Pérez: 3 Balanceado a ₲180.000 cada uno. Además, cobro de ₲200.000 sobre su deuda anterior.

### nat-tres-cosas (`gpt-6-sol`)

> Entiendo: compra de 5 harinas a ₲45.000 cada una a Agro Sur, pago de ₲320.000 de luz del local y venta de 2 remeras básicas a ₲85.000 cada una.

### nat-venta-y-recordatorio (`gpt-6-sol`)

> Venta de 3 Harinas a Rossana por ₲180.000 y recordatorio para cobrarle el viernes. ¿La venta es a crédito?

### nat-producto-y-venta (`gpt-5.5`)

> Voy a cargar Alfajor con venta a ₲5.000 y costo ₲3.000, y registrar la venta de 10 unidades a Ña Rosa.

### nat-otras-iguales (`gpt-6-sol`)

> Venta de otras 2 bolsas de Balanceado a Rossana, a ₲ 180.000 cada una.

### nat-esa-cuota (`gpt-6-sol`)

> Pago de ₲ 400.000 de la cuota del préstamo del celular, hoy.

### nat-el-otro (`gpt-6-sol`)

> También querés anotar el pago de la cuota de ₲ 650.000 del Préstamo de la moto.

### nat-lo-que-te-dije (`gpt-6-sol`)

> Primero, separá ₲400.000 para la cuota del celular (día 5) y ₲650.000 para la moto (día 10). Son ₲1.050.000 en total; de los ₲1.800.000 que te quedan este mes, quedarían ₲750.000 para el resto. No tengo a mano tus otros gastos pendientes, así que no tomaría esos ₲750.000 como libres todavía. ¿Querés que agende las dos cuotas como tareas mensuales?

### nat-corrige-cliente (`gpt-6-sol`)

> La venta de 3 bolsas de Balanceado por ₲ 540.000 era a Rossana, no a Juan Pérez. Hay que anular la de Juan y registrarla a nombre de Rossana.

### nat-corrige-compra (`gpt-6-sol`)

> Corrijo la compra a Agro Sur: eran 2 bolsas de Balanceado, no 20.

### nat-corrige-y-agrega (`gpt-6-sol`)

> Corrijo la venta a Juan Pérez: eran 5 bolsas de Balanceado, no 3. Además, registro una venta aparte de 1 Harina.

### nat-audio-zapatos (`gpt-6-sol`)

> Son 3 pares de Zapato Bristol negro y 2 de Sandalia Tupí. ¿La clienta de siempre es Doña Elsa?

### nat-sin-producto (`gpt-6-sol`)

> ¿Qué producto vendiste, cuántas unidades y «180» es ₲180 o ₲180.000?

### nat-venta-o-compra (`gpt-6-sol`)

> ¿Querés registrar una compra, una venta o ajustar el stock de esas 3 bolsas de Balanceado?

### nat-me-pagaron (`gpt-5.5`)

> ¿Quién te pagó y cuánto? Si fue el total de una deuda, decime “todo” y el cliente.

### nat-tarjeta-cual (`gpt-6-sol`)

> La compra en la farmacia fue de ₲46.000. ¿La hiciste con la Visa Itaú o con la Green?

### nat-monto-raro (`gpt-6-sol`)

> Son 2 Balanceados. ¿A cuánto vendiste cada uno? «18» no me alcanza para confirmar el precio.

### nat-pago-decimales (`gpt-6-sol`)

> Pago de ₲150.500,50 a la Green.

### nat-sueldo (`gpt-6-sol`)

> Sueldo depositado: ₲3.200.000 de ingreso personal.

### nat-captura-no-es-nueva (`gpt-6-sol`)

> En la captura veo el consumo de Punto Farma por ₲46.000 en la Green, pero con una sola entrada visible no puedo confirmar si está duplicado. ¿Aparece otra entrada igual en Tarjetas? Si me mandás una captura donde se vean ambas, lo reviso.

### nat-wa-dictado (`gpt-5.5`)

> Le puedo escribir a Juan Pérez este mensaje: “Hola, Juan. Te aviso que ya llegó tu pedido. Cuando quieras podés pasar a retirarlo.” ¿Lo envío?

### nat-wa-sin-texto (`gpt-5.5`)

> ¿Le mando este mensaje a Rossana?
> 
> “Hola, Rossana. Te escribo para consultar si podrías regularizar el saldo pendiente de ₲200.000. Quedo atento, gracias.”
