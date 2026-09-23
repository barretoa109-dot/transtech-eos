# Costo real de subir de plan la infraestructura (punto 2 del plan de fortalecimiento)

**Fecha de la cotización:** 2026-09-22. Precios públicos de las páginas oficiales de
Supabase y Vercel — confirmar en el momento de decidir, porque cambian sin aviso.

**Por qué existe este documento:** en `eos-rc1-status` y en `eos-plan-pre-lanzamiento`
el upgrade de Supabase quedó "pendiente" desde 2026-08-18 sin que nadie le pusiera un
número. Cinco semanas después seguía sin decidirse. La razón más probable no es que
sea una mala idea — es que nadie la convirtió en una cifra concreta para aprobar o
rechazar. Este documento es esa cifra.

## Supabase: Pro + PITR

| Ítem | Costo mensual (USD) | Qué desbloquea |
|---|---|---|
| Plan Pro (base) | $25 (incluye $10 de crédito de cómputo) | Protección de contraseñas filtradas (HIBP) — la que devolvía 402 en el plan free — y el resto de las funciones "solo Pro" |
| PITR, 7 días de retención | **+$100** (NO viene incluido en Pro) | Restaurar la base a un punto exacto en el tiempo si algo sale mal — el punto 47 de la lista maestra, hoy sin poder cumplirse |
| **Total mínimo** | **$125/mes** | |

Fuente: [Supabase Pricing 2026 — Flexprice](https://flexprice.io/blog/supabase-pricing-breakdown), confirmado por
[selfhost.dev](https://selfhost.dev/blog/supabase-pricing-explained/) y
[makerkit.dev](https://makerkit.dev/blog/saas/supabase-pricing). El $10 de crédito de cómputo del plan
Pro puede no alcanzar según el tamaño de instancia elegido — con el volumen actual (6-7
cuentas reales) el free tier ya alcanza para cómputo, así que $125 es un techo razonable
para arrancar, no una garantía de que no haya overage.

**Recomendación:** activar Pro ($25) apenas arranque el piloto comercial —
desbloquea HIBP sin condiciones. PITR ($100 extra) puede esperar hasta que haya
plata real de clientes circulando por la base (suscripciones activas, no solo
datos de prueba) — es la diferencia entre "proteger cuentas de prueba" y "proteger
cobros reales". Mi sugerencia: sumar los $100 el mismo mes en que se apruebe el
"acta de decisión de lanzamiento" (punto 10 de la lista maestra), no antes.

## Vercel: Pro

| Ítem | Costo mensual (USD) | Qué desbloquea |
|---|---|---|
| Plan Pro, 1 asiento | $20 (incluye $20 de crédito de uso) | 12 builds concurrentes (vs. 1 en Hobby) — se acaba la cola trancada que hoy obliga a "Promote to Production" manual |

Fuente: [Vercel Pro Plan — docs oficiales](https://vercel.com/docs/plans/pro-plan), confirmado por
[Flexprice](https://flexprice.io/blog/vercel-pricing-breakdown) y
[Temps](https://temps.sh/blog/vercel-pricing-2026-pro-plan-explained). Además de los 12
builds concurrentes, el crédito de $20 cubre bandwidth/funciones extra hasta ese
monto — con el tráfico actual (6-7 cuentas reales) no debería generar overage.

**Recomendación:** activar antes que Supabase Pro, no después. Es la mejora operativa
de menor costo y más directa de todo este documento: **$20/mes elimina por completo**
el problema descrito en `eos-despliegue-pr-vercel` (colas trancadas, deploys "Ready"
que no toman el dominio, que otra sesión tenga que esperar a que termine un deploy
ajeno antes de subir el suyo). Con 4-5 sesiones de IA trabajando el mismo repo en
paralelo, cada una potencialmente disparando un deploy, este cuello de botella se
va a poner peor, no mejor, cuantas más sesiones trabajen a la vez.

## Total combinado

| Escenario | Costo mensual |
|---|---|
| Solo Vercel Pro (arrancar ya) | $20 |
| + Supabase Pro (con el piloto) | $45 |
| + PITR (con el lanzamiento comercial) | $145 |

Comparado contra el precio de un solo cliente del plan "EOS Conversacional"
(Gs. 60.000 ≈ USD 7,5, ver `eos-costo-por-mensaje-y-precio`), el total de $145/mes
equivale a **~19 suscripciones de ese plan** — un techo bajo si el piloto (3-10
cuentas) ya paga varias de ellas. No es un gasto que compita con la operación; es
menor al margen de un puñado de clientes reales.

## Decisión que le toca al usuario

Aprobar el gasto y cargar la tarjeta en Vercel y Supabase — ninguna sesión de IA
puede ni debe hacer eso (entrar datos de pago está fuera de lo que cualquier
asistente puede ejecutar). Con este documento ya no falta la cifra, solo el "sí".
