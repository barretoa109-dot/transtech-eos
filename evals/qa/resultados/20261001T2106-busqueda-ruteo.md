# QA con tope — busqueda · ruteo de producción (2026-10-01)

Modelo: el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5), razonamiento `low`, `max_output_tokens` 1200, tope US$ 0.15. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| bus-precio-producto-py | `gpt-6-sol` → `gpt-6-sol` | BUSCAR_WEB | 12622 / 0 / 82 | 0.02606 | OK |
| bus-tendencias-rubro | `gpt-6-sol` → `gpt-6-sol` | BUSCAR_WEB + BUSCAR_WEB | 12661 / 12339 / 104 | 0.00415 | OK |
| bus-competidores | `gpt-6-sol` → `gpt-6-sol` | BUSCAR_WEB | 12679 / 12339 / 91 | 0.00406 | OK |
| bus-sin-ubicacion | `gpt-6-sol` → `gpt-6-sol` | BUSCAR_WEB | 12615 / 12339 / 72 | 0.00374 | OK |
| bus-no-hace-falta-contexto | `gpt-6-sol` → `gpt-6-sol` | — | 12613 / 12339 / 33 | 0.00335 | OK |
| bus-no-hace-falta-consejo | `gpt-6-sol` → `gpt-6-sol` | — | 12615 / 12339 / 98 | 0.00400 | OK |

**6/6 · 6 llamadas · US$ 0.04536**

## Respuestas

### bus-precio-producto-py (`gpt-6-sol`)

> Voy a buscar el precio actual del iPhone 15 de 128 GB en Paraguay.
> [BUSCAR_WEB {"consulta":"precio iPhone 15 128 GB Paraguay","pais":"PY"}]

### bus-tendencias-rubro (`gpt-6-sol`)

> Voy a buscar tendencias actuales de ropa deportiva femenina y precios de referencia en Paraguay.
> [BUSCAR_WEB {"consulta":"tendencias actuales ropa deportiva femenina Paraguay","pais":"PY"}]
> [BUSCAR_WEB {"consulta":"precios conjuntos deportivos tops calzas mujer Paraguay","pais":"PY"}]

### bus-competidores (`gpt-6-sol`)

> Voy a comparar precios publicados de bolsas de cemento de 50 kg en ferreterías grandes de Asunción y citar las fuentes.
> [BUSCAR_WEB {"consulta":"precio cemento bolsa 50 kg ferreterías grandes Asunción Paraguay","pais":"PY","profundidad":"profunda"}]

### bus-sin-ubicacion (`gpt-6-sol`)

> Voy a consultar el precio actual del litro de nafta en Paraguay.
> [BUSCAR_WEB {"consulta":"precio actual litro nafta Paraguay estaciones de servicio","pais":"PY"}]

### bus-no-hace-falta-contexto (`gpt-6-sol`)

> No tengo a mano el total de ventas de este mes. Podés consultarlo en Negocio > Ventas.

### bus-no-hace-falta-consejo (`gpt-6-sol`)

> 1. Armá un combo dominical de productos que ya vendés, por ejemplo, balanceado y harina, con un beneficio que no te coma el margen.
> 2. Avisá el sábado por WhatsApp qué productos vas a tener disponibles el domingo y tomá pedidos anticipados.
> 3. Probá durante cuatro domingos un horario corto de atención y anotá las ventas de esa franja para ver si conviene mantenerlo.
