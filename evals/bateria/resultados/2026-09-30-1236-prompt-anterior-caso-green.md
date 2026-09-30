# Batería de frases — 2026-09-30

Modelo: `gpt-5.5` · esfuerzo `medium` · 4 frases · **0 % de verbo correcto** (meta: ≥ 95 %).

| Grupo | Acierto |
|---|---|
| personal | 0/4 (0 %) |

| Rubro | Acierto |
|---|---|
| almacen | 0/4 (0 %) |

## Tiempo del modelo

Mediana 9,0 s · p90 14,7 s · máximo 14,7 s. Tokens de razonamiento: mediana 516, p90 994.

## Las que fallaron

- `green-varias-cosas` — "Gaste 46.000gs en Punto Farma con mi tarjeta de crédito Green que por cierto ya pagué el pago mínimo, y gané también 100.000gs recién" → REGISTRAR_COMPRA_TARJETA+REGISTRAR_MOVIMIENTO_PERSONAL+REGISTRAR_PAGO_DEUDA; usó REGISTRAR_PAGO_DEUDA, que está prohibido acá. _La compra va a la tarjeta y el ingreso a Personal; 'ya pagué el mínimo' es contexto y el 188.000 del contexto no es un pago._ Respondió: «A registrar: compra en Punto Farma por ₲46.000 con la Green, pago mínimo de la Green por ₲188.000, e ingreso personal de ₲100.000.»
- `green-donde-esta` — "En donde se supone que lo anotaste? Porque en el apartado Personal no está" → REGISTRAR_COMPRA_TARJETA+REGISTRAR_MOVIMIENTO_PERSONAL+REGISTRAR_PAGO_DEUDA; usó REGISTRAR_COMPRA_TARJETA, que está prohibido acá. _Ya está anotada: se dice dónde verla. Cada 'no está' la volvía a mandar (cinco compras)._ Respondió: «Punto Farma debería aparecer en Personal › Tengo y debo › Tarjetas › Green, no como gasto de Mi mes. El ingreso de ₲ 100.000 sí va en Personal › Mi mes › Movimientos. Como no te aparece, lo reintento ahora, incluyendo el pago mínimo de Green por ₲ 188.000.»
- `green-no-hiciste-nada` — "No está, no hiciste nada" → REGISTRAR_COMPRA_TARJETA+REGISTRAR_MOVIMIENTO_PERSONAL+REGISTRAR_PAGO_DEUDA; usó REGISTRAR_PAGO_DEUDA, que está prohibido acá. _Reenviar la compra ya no duplica (v221), pero tocar la tarjeta con datos del contexto le cambió el emisor y el resumen._ Respondió: «Vuelvo a registrarlo: compra con la Green por ₲46.000 en Punto Farma, pago mínimo de la Green por ₲188.000 e ingreso personal de ₲100.000.»
- `green-pague-el-minimo` — "ya pagué el mínimo de la Green" → REGISTRAR_PAGO_DEUDA; usó REGISTRAR_PAGO_DEUDA, que está prohibido acá. _Una tarjeta no es una deuda; el mínimo del contexto es lo que debía, no lo que pagó._ Respondió: «Registro el pago del mínimo de la Green por ₲188.000.»
