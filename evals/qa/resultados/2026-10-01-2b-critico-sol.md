# QA con tope — prompt con INC-19 (2026-10-01)

Modelo de QA `gpt-6-luna`, razonamiento `low`, `max_output_tokens` 1200, tope US$ 1. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| asesoria-prioridad-prestamos | `gpt-6-luna` → `gpt-6-luna` | — | 11783 / 11780 / 421 | 0.00033 | FALLA: no guardó la prioridad |
| asesoria-prioridad-prestamos | `gpt-6.1-sol` → `gpt-6.1-sol` | GUARDAR_MEMORIA | 11783 / 11780 / 239 | 0.00475 | OK |

**1/2 · 2 llamadas · US$ 0.00508**

## Respuestas

### asesoria-prioridad-prestamos (`gpt-6-luna`)

> Priorizá primero la cuota del celular (₲400.000, día 5) y después la de la moto (₲650.000, día 10): en total son ₲1.050.000. Después destiná lo que quede a las reparaciones, empezando por la que sea más urgente o necesaria para tu seguridad. Este mes figuran ₲1.200.000 de salidas, pero no sé si incluyen esas cuotas. ¿Cuánto tenés disponible para este mes y esos ₲1.200.000 ya incluyen los préstamos?
> 
> {
>   "acciones": [
>     {
>       "tipo": "GUARDAR_MEMORIA",
>       "datos": {
>         "titulo": "Prioridad de pagos",
>         "categoria": "preferencias",
>         "contenido": "Prioriza los préstamos del celular y de la moto porque se descuentan todos los meses.",
>         "importancia": "media"
>       }
>     }
>   ]
> }

### asesoria-prioridad-prestamos (`gpt-6.1-sol`)

> Este mes, ordená así:
> 1. Primero reservá ₲1.050.000 para los préstamos: celular, ₲400.000 el 5; moto, ₲650.000 el 10. Como te los descuentan, no cuentes esa plata para arreglos.
> 2. Después, pedí presupuesto para la moto y el aire. Si la moto es necesaria para trabajar o tiene una falla de seguridad, va antes que el aire.
> 3. Con lo que quede después de las cuotas y los gastos básicos, decidí qué reparación podés pagar sin sumar deuda.
> 
> Ya salieron ₲1.200.000 este mes y no hay ingresos registrados; eso no indica cuánto tenés disponible. ¿Cuánto tenés hoy y cuánto ingreso seguro te falta cobrar este mes? Con eso ajustamos el plan y, si querés, lo cargamos como tareas.
