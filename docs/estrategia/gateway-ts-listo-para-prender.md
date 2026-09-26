# Gateway TS: confirmado listo, solo falta la variable de entorno (punto 1)

> **Actualización 26/09/2026: ya está prendido, en etapa 3.** `npm run go` lo
> confirma contra producción. Este documento queda como historia del llamado a
> prenderlo; el estado vigente está en `docs/salida-de-n8n.md`.


**No duplica `docs/salida-de-n8n.md`** — ese documento es el runbook técnico
completo (qué porta cada etapa, qué variables hacen falta, qué se degrada si
algo falla). Esto es la confirmación de que sigue vigente hoy y el llamado a
acción concreto.

## Verificado el 2026-09-22

```
node --test "lib/gateway/**/*.test.ts"
→ 291 tests, 291 pass, 0 fail
```

El código de las tres etapas sigue sano en `origin/main`. Nada se rompió
desde que se escribió en septiembre. **No hay ninguna razón técnica para
seguir esperando.**

## La única acción pendiente

Es la mejora de mayor impacto por menor esfuerzo de todo el plan de
fortalecimiento, y sigue sin prenderse porque **ninguna sesión de Code puede
cargar variables de entorno en Vercel** — el clasificador de permisos lo
bloquea a propósito, es una escritura de producción real.

**Etapa 1 (la más segura — no deja rastro si algo sale mal):**

En Vercel → Settings → Environment Variables (Production):

```
OPENAI_API_KEY=<la clave de OpenAI>
EOS_GATEWAY_TS=1
```

Redesplegar después de cargarlas (una variable nueva no aplica a un build ya
hecho). Verificar con un mensaje real de conversación pura que
`metadata.gateway` diga `"ts"` en la respuesta — así se sabe que pasó por
Vercel y no por n8n.

**Etapas 2 y 3:** ejecutan acciones reales — dejar semanas de por medio
después de prender la etapa 1, como ya estaba decidido, no las tres juntas
el mismo día. Las variables exactas de cada una están en
`docs/salida-de-n8n.md`.

## Qué mirar después de prender la etapa 1

- Latencia real de la conversación pura (debería acercarse a los 2,4-4s ya
  medidos en pruebas, no a los ~19s de mediana que incluye el salto a n8n).
- Que el camino con acciones (que sigue yendo por n8n en la etapa 1) no
  cambió — es la garantía de que la bandera no tocó nada fuera de la
  conversación pura.
- Costo duplicado esperado en los mensajes que SÍ piden una acción: la
  llamada a OpenAI que hizo Vercel se descarta y n8n vuelve a llamar. Es
  aceptado a sabiendas (es la minoría del tráfico) y desaparece en la etapa 2.
