# QA con tope — prompt con INC-19 (2026-10-01)

Modelo de QA `gpt-6-luna`, razonamiento `low`, `max_output_tokens` 1200, tope US$ 1. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| asesoria-prioridad-prestamos | `gpt-6-luna` → `gpt-6-luna` | GUARDAR_MEMORIA | 11783 / 11780 / 604 | 0.00042 | OK |
| asesoria-sin-base | `gpt-6-luna` → `gpt-6-luna` | GUARDAR_MEMORIA | 11762 / 11480 / 246 | 0.00027 | OK |

**2/2 · 2 llamadas · US$ 0.00069**

## Respuestas

### asesoria-prioridad-prestamos (`gpt-6-luna`)

> Este mes, separá primero ₲400.000 para el préstamo del celular, que vence el día 5, y ₲650.000 para el de la moto, que vence el día 10. Después destiná lo disponible a arreglar el aire acondicionado y la moto, empezando por lo más urgente; todavía no tengo los costos de esas reparaciones. En tus movimientos del mes figuran ₲1.200.000 de salidas y ningún ingreso, así que no puedo confirmar si alcanza. ¿Cuánto tenés disponible o vas a cobrar este mes?

### asesoria-sin-base (`gpt-6-luna`)

> ¿Cuánto recibís como ingreso fijo seguro por mes, sin contar comisiones ni horas extra? Con eso calculo cuánto podrías ahorrar; lo variable lo tomaría como extra.
