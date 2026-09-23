# Seguimiento a Bancard — pase a producción (punto 3 del plan de fortalecimiento)

**Por qué esto no lo puede cerrar una sesión de Code:** de nuestro lado el
código está terminado y verificado en staging (tokenización, pago ocasional,
3DS, webhook, cron de renovación — ver `eos-bancard-certificacion` y
`eos-rc1-status`). Lo único que falta es que Bancard, como empresa, apruebe la
certificación que ya se les envió. Es una gestión comercial externa, no una
tarea técnica.

## Última evidencia registrada (verificar que siga vigente antes de usar este documento)

- **2026-08-22:** checklist de staging completo en el portal de Bancard (Pago
  con token y Pago ocasional, las dos listas en verde).
- **2026-08-25:** 3DS validado de punta a punta contra `transtech.com.py`
  (`shop_process_id` 1000018). ZIMPLE descartado por decisión propia,
  comunicada y aceptada por Bancard.
- **2026-08-25 15:52:** confirmación enviada a Soporte vPos con la referencia
  de la corrida completa. Desde entonces, sin novedades registradas en la
  memoria de este proyecto — es decir, **han pasado ~4 semanas sin una
  respuesta confirmada de Bancard sobre el pase a producción.**

## Mensaje de seguimiento listo para enviar

Asunto: **Seguimiento — Solicitud de certificación vPOS 2.0, comercio 2290856 (TRANSTECH)**

> Estimados,
>
> Escribo para dar seguimiento a nuestra solicitud de certificación vPOS 2.0
> del comercio 2290856 (TRANSTECH E.A.S.), enviada el 25 de agosto de 2026
> junto con la evidencia de los tres flujos validados en staging (Pago con
> Token, Pago Ocasional y 3DS — referencia de corrida `shop_process_id`
> 1000018).
>
> Quisiera confirmar el estado de la revisión y si hace falta algún dato
> adicional de nuestro lado para avanzar con la habilitación en producción.
> Quedamos atentos.
>
> Saludos,
> [nombre del usuario]
> TRANSTECH E.A.S. — RUC 80174259-5

## Qué hacer apenas Bancard confirme el pase

Es un cambio atómico de tres variables en Vercel (ya documentado, no hace
falta redescubrirlo):

1. `BANCARD_PUBLIC_KEY` → clave de producción (distinta de la de staging).
2. `BANCARD_PRIVATE_KEY` → clave de producción. **Cuidado con el `$`** dentro
   de la clave: Next.js expande `$VAR` en archivos `.env`, así que si se
   carga en `.env.local` hay que escaparlo como `\$`. En Vercel (donde
   realmente importa) no hace falta escapar nada.
3. `BANCARD_ENV` → `production` (hoy es `staging`, el valor seguro por
   default).

Las tres deben cambiar **juntas** — cambiar solo `BANCARD_ENV` sin las claves
de producción deja todos los cobros fallando con una firma rechazada, que no
se lee como "clave equivocada" y puede confundir el diagnóstico.

`BANCARD_ENV` ya está en el chequeo de salud (`/api/internal/salud`) —
verificar ahí después del cambio que diga `production`, no solo confiar en
que el deploy salió bien.
