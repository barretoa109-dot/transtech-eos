# QA con tope — busqueda · ruteo de producción (2026-10-01)

Modelo: el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5), razonamiento `low`, `max_output_tokens` 1200, tope US$ 0.3. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| bus-privados | `gpt-5.5` → `gpt-5.5-2026-04-23` | BUSCAR_WEB | 12633 / 9984 / 152 | 0.02280 | OK |
| bus-seguimiento | `gpt-6-sol` → `gpt-6-sol` | — | 12805 / 12339 / 116 | 0.00456 | OK |
| bus-contradice | `gpt-6-sol` → `gpt-6-sol` | BUSCAR_WEB | 12681 / 12339 / 83 | 0.00398 | OK |
| bus-con-venta | `gpt-6-sol` → `gpt-6-sol` | REGISTRAR_VENTA + BUSCAR_WEB | 12630 / 12339 / 125 | 0.00430 | OK |

**4/4 · 4 llamadas · US$ 0.03564**

## Respuestas

### bus-privados (`gpt-5.5`)

> Voy a buscar precios actuales de bolsa de balanceado en Paraguay para que tengas una referencia antes de cobrarle a Juan Pérez.
> [BUSCAR_WEB {"consulta":"precio bolsa balanceado Paraguay","pais":"PY"}]

### bus-seguimiento (`gpt-6-sol`)

> Te conviene mantener la bolsa a ₲58.000: ganás ₲9.000 por unidad antes de otros gastos. Si igualaras la promoción de ₲52.900, te quedarían ₲3.900. Bajaría el precio solo para una venta por volumen que justifique esa diferencia.

### bus-contradice (`gpt-6-sol`)

> Voy a comparar precios publicados de cemento de 50 kg en Paraguay para ver si ₲40.000 es un precio generalizado.
> [BUSCAR_WEB {"consulta":"precio cemento bolsa 50 kg Paraguay San Lorenzo","pais":"PY"}]

### bus-con-venta (`gpt-6-sol`)

> Voy a registrar la venta de 3 bolsas de Balanceado a ₲180.000 cada una y consultar el precio de mercado en Paraguay.
> [BUSCAR_WEB {"consulta":"precio bolsa balanceado Paraguay mercado","pais":"PY"}]
