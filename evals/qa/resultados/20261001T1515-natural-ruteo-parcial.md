# QA con tope — natural · ruteo de producción (2026-10-01)

Modelo: el de producción para cada caso (elegirModelo: gpt-6-sol o gpt-5.5), razonamiento `low`, `max_output_tokens` 1200, tope US$ 0.3. Sin ejecutar acciones ni tocar la base.

| Caso | Modelo pedido → respondido | Acciones | Tokens (entrada / caché / salida) | USD | Resultado |
|---|---|---|---|---|---|
| nat-wa-dictado | `gpt-5.5` → `gpt-5.5-2026-04-23` | ENVIAR_WHATSAPP_CLIENTE | 12149 / 9984 / 112 | 0.01918 | OK |
| nat-wa-sin-texto | `gpt-5.5` → `gpt-5.5-2026-04-23` | — | 12146 / 12032 / 103 | 0.00968 | OK |

**2/2 · 2 llamadas · US$ 0.02885**

## Respuestas

### nat-wa-dictado (`gpt-5.5`)

> Voy a enviarle a Juan Pérez: “Hola, Juan. Ya llegó tu pedido.”

### nat-wa-sin-texto (`gpt-5.5`)

> ¿Qué querés que le diga a Rossana? Si es por su saldo, puedo mandarle: “Hola, Rossana. Te escribimos para recordarte que tenés un saldo pendiente de ₲200.000. ¿Nos confirmás cuándo podrías abonarlo?”
