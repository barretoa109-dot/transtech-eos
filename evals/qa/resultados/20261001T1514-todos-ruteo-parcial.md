# QA con tope — todos · ruteo de producción (2026-10-01)

Modelo: el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5), razonamiento `low`, `max_output_tokens` 1200, tope US$ 0.3. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| asesoria-prioridad-prestamos | `gpt-6-sol` → `gpt-6-sol` | GUARDAR_MEMORIA | 12177 / 0 / 248 | 0.02683 | OK |
| asesoria-ingreso-variable | `gpt-6-sol` → `gpt-6-sol` | GUARDAR_MEMORIA | 12163 / 11874 / 333 | 0.00628 | OK |
| regresion-green-varias-cosas | `gpt-5.5` → `gpt-5.5-2026-04-23` | REGISTRAR_COMPRA_TARJETA + REGISTRAR_MOVIMIENTO_PERSONAL | 12199 / 0 / 299 | 0.06996 | OK |
| nat-venta-nomas | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA | 12149 / 11874 / 74 | 0.00366 | OK |
| nat-sin-tildes-cobro | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_COBRO | 12151 / 11874 / 52 | 0.00345 | OK |
| nat-tres-cosas | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_COMPRA + REGISTRAR_COMPRA + REGISTRAR_VENTA | 12173 / 11874 / 230 | 0.00527 | OK |
| nat-venta-y-recordatorio | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA + CREAR_TAREA | 12159 / 11874 / 141 | 0.00435 | OK |
| nat-lo-que-te-dije | `gpt-6-sol` → `gpt-6-sol` | — | 12176 / 11874 / 176 | 0.00474 | OK |
| nat-audio-zapatos | `gpt-6-sol` → `gpt-6-sol` | — | 12144 / 11874 / 87 | 0.00378 | OK |
| nat-monto-raro | `gpt-6-sol` → `gpt-6-sol` | — | 12149 / 11874 / 137 | 0.00429 | FALLA: dice /₲ ?18\b|₲ ?36\b/ |

**9/10 · 10 llamadas · US$ 0.13264**

## Respuestas

### asesoria-prioridad-prestamos (`gpt-6-sol`)

> Este mes, primero reservá ₲400.000 para el préstamo del celular (día 5) y ₲650.000 para el de la moto (día 10). Después, presupuestá los arreglos: priorizá la moto si la necesitás para moverte o trabajar, y luego el aire. Ya figuran ₲1.200.000 de salidas este mes; no sé si incluyen esas cuotas, así que no las sumo de nuevo. ¿Cuánto tenés de ingreso fijo este mes? Con eso puedo ordenar los arreglos sin comprometer las cuotas. Si querés, también te cargo los pasos como tareas.

### asesoria-ingreso-variable (`gpt-6-sol`)

> Tomá los ₲3.000.000 de sueldo base como presupuesto; las comisiones y horas extra, como plata adicional, no comprometida de antemano.
> 1. Apartá ₲400.000 para el celular (día 5) y ₲650.000 para la moto (día 10).
> 2. Te quedan ₲1.950.000 para los demás gastos y el ahorro. Este mes ya salieron ₲1.200.000, pero no sé si ahí están incluidas esas cuotas, así que no puedo decirte cuánto queda disponible sin duplicarlas.
> 3. Cuando cobres lo variable, destiná primero una parte a cubrir el mes siguiente y después al ahorro. Si querés, podemos ajustar el reparto con tus gastos habituales y cargar los vencimientos como tareas.

### regresion-green-varias-cosas (`gpt-5.5`)

> Voy a registrar la compra de ₲46.000 en Punto Farma con la Green y el ingreso personal de ₲100.000. Si querés, también anoto el pago mínimo de la Green.

### nat-venta-nomas (`gpt-6-sol`)

> Venta de 2 Balanceados hoy, al precio del catálogo.

### nat-sin-tildes-cobro (`gpt-6-sol`)

> Voy a registrar un cobro de ₲300.000 de Juan Pérez por su deuda.

### nat-tres-cosas (`gpt-6-sol`)

> Voy a registrar la compra de 5 harinas a ₲45.000 cada una a Agro Sur, el pago de ₲320.000 de luz del local y la venta de 2 remeras básicas a ₲85.000 cada una.

### nat-venta-y-recordatorio (`gpt-6-sol`)

> Venta a crédito de 3 Harinas a Rossana por ₲180.000. Recordatorio para cobrarle el viernes.

### nat-lo-que-te-dije (`gpt-6-sol`)

> Primero, separá ₲400.000 para el préstamo del celular (día 5) y ₲650.000 para el de la moto (día 10): ₲1.050.000 en total. Después de eso, de los ₲1.800.000 que quedan según tus movimientos del mes, restarían ₲750.000 para los demás gastos. Ese cálculo no confirma cuánto tenés hoy en tus cuentas. Si querés, te cargo los dos pagos como tareas mensuales.

### nat-audio-zapatos (`gpt-6-sol`)

> Entendí 3 pares de Zapato Bristol negro y 2 de Sandalia Tupí. ¿Fue a Doña Elsa o a Marcos Giménez?

### nat-monto-raro (`gpt-6-sol`)

> Venta de 2 Balanceados a ₲18.000 cada uno. El precio habitual es ₲180.000: ¿confirmás que los vendiste a ₲18.000?
