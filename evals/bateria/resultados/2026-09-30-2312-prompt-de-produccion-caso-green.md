# Batería de frases — 2026-09-30

Modelo: `gpt-5.5` · esfuerzo `low` · 1 frases · **0 % de verbo correcto** (meta: ≥ 95 %).

| Grupo | Acierto |
|---|---|
| personal | 0/1 (0 %) |

| Rubro | Acierto |
|---|---|
| almacen | 0/1 (0 %) |

## Tiempo del modelo

Mediana 5,5 s · p90 5,5 s · máximo 5,5 s. Tokens de razonamiento: mediana 71, p90 71.

## Las que fallaron

- `green-varias-cosas` — "Gaste 46.000gs en Punto Farma con mi tarjeta de crédito Green que por cierto ya pagué el pago mínimo, y gané también 100.000gs recién" → REGISTRAR_COMPRA_TARJETA+REGISTRAR_MOVIMIENTO_PERSONAL+REGISTRAR_PAGO_DEUDA; usó REGISTRAR_PAGO_DEUDA, que está prohibido acá. _La compra va a la tarjeta y el ingreso a Personal; 'ya pagué el mínimo' es contexto y el 188.000 del contexto no es un pago._ Respondió: «Voy a registrar la compra de ₲46.000 en Punto Farma con la Green, el pago mínimo de la Green y el ingreso personal de ₲100.000.»
