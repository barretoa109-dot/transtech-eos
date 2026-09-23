# Checklist de WhatsApp Business / Meta (punto 5 del plan de fortalecimiento)

**Por qué es prioritario:** de las dos cuentas reales retenidas en la
evidencia de uso, una opera principalmente por WhatsApp (40 mensajes). El
canal ya está construido del lado de EOS (CRM > Conversaciones,
`lib/whatsapp-crm/`, ver `eos-reorganizacion-negocios`) — **hoy solo
RECIBE, no puede enviar**, porque falta la gestión con Meta. Es, de los 12
puntos del plan, el que tiene menor esfuerzo técnico restante y mayor
apalancamiento de adquisición: cerrarlo no requiere escribir código nuevo.

## Lo que falta, paso a paso

1. **Cuenta de WhatsApp Business API en Meta Business Manager** (si todavía
   no existe una para TRANSTECH o para la empresa piloto). Requiere un
   número de teléfono dedicado que no esté ya usado en la app normal de
   WhatsApp.
2. **Verificación del negocio ante Meta** (Meta Business Verification) —
   puede tardar días; conviene iniciarla ya, en paralelo a lo demás, porque
   es lo único de esta lista con tiempo de espera fuera de nuestro control.
3. **Generar el token de acceso permanente** (no el token temporal de 24hs
   que da el modo de prueba) desde el panel de desarrolladores de Meta.
4. **Guardar el token en Supabase Vault**, no en una variable de entorno
   plana — el código ya espera esto en
   `eos_wa_canales.secreto_ref` (ver `eos-reorganizacion-negocios`).
5. **Crear y enviar a aprobación las plantillas de mensaje** (message
   templates) que EOS va a usar para iniciar conversaciones fuera de la
   ventana de 24 horas — por ejemplo, un aviso de "tenés un cliente
   esperando respuesta" o un recordatorio de cobro. Meta las revisa antes
   de habilitarlas; conviene mandar 2-3 plantillas simples primero en vez
   de una lista larga, para no arriesgar un rechazo masivo.

## Qué NO hace falta

- No hace falta esperar a que las 5 pasos estén completos para el piloto:
  con el canal solo recibiendo, EOS ya puede leer y registrar lo que un
  cliente le escribe a la empresa. Enviar es lo que falta.
- No prometer al cliente piloto que "EOS ve lo que la empresa contesta
  desde su propia app de WhatsApp" — con la API de Meta esa respuesta
  manual no llega a EOS. Aclarar esto de entrada evita una decepción después.

## Verificación una vez conectado el token

No hace falta pedirle a una sesión de Code que adivine si funciona: correr
un envío real de prueba a un número propio (no a un cliente) y confirmar en
`CRM > Conversaciones` que aparece como enviado, y que el cliente de prueba
lo recibió de verdad en su WhatsApp.

Relacionado: `docs/whatsapp-crm.md` (documentación técnica del canal ya
construido).
