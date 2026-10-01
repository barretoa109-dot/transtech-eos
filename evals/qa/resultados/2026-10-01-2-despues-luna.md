# QA con tope — prompt con INC-19 (2026-10-01)

Modelo de QA `gpt-6-luna`, razonamiento `low`, `max_output_tokens` 1200, tope US$ 1. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| asesoria-prioridad-prestamos | `gpt-6-luna` → `gpt-6-luna` | — | 11765 / 0 / 394 | 0.00137 | FALLA: no guardó la prioridad |
| asesoria-ingreso-variable | `gpt-6-luna` → `gpt-6-luna` | GUARDAR_MEMORIA | 11751 / 11462 / 509 | 0.00040 | OK |
| asesoria-sin-base | `gpt-6-luna` → `gpt-6-luna` | — | 11744 / 11462 / 380 | 0.00033 | OK |
| asesoria-recuerda-prioridad | `gpt-6-luna` → `gpt-6-luna` | — | 11797 / 11462 / 558 | 0.00043 | OK |
| regresion-green-varias-cosas | `gpt-6-luna` → `gpt-6-luna` | REGISTRAR_COMPRA_TARJETA + REGISTRAR_MOVIMIENTO_PERSONAL | 11787 / 11462 / 306 | 0.00030 | OK |
| regresion-venta-simple | `gpt-6-luna` → `gpt-6-luna` | REGISTRAR_VENTA | 11740 / 11462 / 108 | 0.00020 | OK |

**5/6 · 6 llamadas · US$ 0.00303**

## Respuestas

### asesoria-prioridad-prestamos (`gpt-6-luna`)

> Las cuotas suman ₲1.050.000 al mes: primero reservá ₲400.000 para el préstamo del celular, con vencimiento el 5, y ₲650.000 para el de la moto, con vencimiento el 10. Después ordenamos cuánto destinar a las reparaciones. Este mes figura un saldo de ₲-1.200.000; para armar un plan realista, ¿cuánto dinero tenés disponible o esperás cobrar, y cuánto calculás que cuestan los arreglos?
> 
> "acciones":[{"tipo":"GUARDAR_MEMORIA","datos":{"titulo":"Prioridad financiera","categoria":"preferencias","contenido":"La persona prioriza los préstamos del celular y de la moto porque se los descuentan todos los meses.","importancia":"alta"}}]}

### asesoria-ingreso-variable (`gpt-6-luna`)

> Con el sueldo base de ₲3.000.000, separá primero ₲400.000 para el préstamo del celular antes del día 5 y ₲650.000 para el de la moto antes del día 10. Quedan ₲1.950.000; si los ₲1.200.000 que salieron este mes representan tus gastos habituales, reservá ese monto y quedan ₲750.000 de margen. Como no tengo el detalle de esos gastos, no puedo repartir esa parte por categorías. Usá las comisiones y horas extra como ingreso variable: primero cubrí cualquier gasto esencial que exceda el presupuesto base y después destiná el resto a un fondo de respaldo, sin comprometerlo como ingreso fijo.

### asesoria-sin-base (`gpt-6-luna`)

> Con lo registrado, este mes salieron ₲1.200.000 y las cuotas de tus préstamos suman ₲1.050.000 al mes. Para calcular cuánto podés ahorrar sin contar ingresos variables, ¿cuánto recibís de sueldo fijo, sin comisiones ni horas extra?
> {
>   "respuesta": "Con lo registrado, este mes salieron ₲1.200.000 y las cuotas de tus préstamos suman ₲1.050.000 al mes. Para calcular cuánto podés ahorrar sin contar ingresos variables, ¿cuánto recibís de sueldo fijo, sin comisiones ni horas extra?",
>   "acciones": [
>     {
>       "tipo": "GUARDAR_MEMORIA",
>       "datos": {
>         "titulo": "Composición del ingreso",
>         "categoria": "finanzas personales",
>         "contenido": "El ingreso varía por comisiones y horas extra; el monto del sueldo fijo no está especificado.",
>         "importancia": "media"
>       }
>     }
>   ]
> }

### asesoria-recuerda-prioridad (`gpt-6-luna`)

> Este mes, priorizá los préstamos como decidiste: reservá ₲400.000 para el del celular el día 5 y ₲650.000 para el de la moto el día 10. Con el sueldo base de ₲3.000.000 y los ₲1.200.000 de salidas ya registrados, quedarían ₲750.000 para arreglar la moto, antes de sumar comisiones u horas extra.
> 
> ¿Cuánto estimás que cuesta el arreglo? Así vemos si alcanza sin contar con ingresos variables.

### regresion-green-varias-cosas (`gpt-6-luna`)

> Cargo el gasto de ₲46.000 en Punto Farma con la Green y el ingreso de ₲100.000. ¿Querés que anote también el pago mínimo? ¿Cuánto pagaste?

### regresion-venta-simple (`gpt-6-luna`)

> Venta de 3 bolsas de Balanceado a ₲180.000 cada una.
