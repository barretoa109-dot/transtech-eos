# Plan del piloto comercial (punto 6 del plan de fortalecimiento)

El piloto (punto 50 de la lista maestra) ya estaba decidido: 3-10 clientes
reales, monitoreados ~1 semana. Este documento lo convierte en un plan
ejecutable, y le agrega la función de marketing que el documento CEO/COO/CMO/CFO
propuso: el piloto es el primer activo de adquisición, no solo una prueba técnica.

## A quién invitar (criterio de selección)

Usar el ICP validado por la evidencia real, no el público general:

- **Dueño de una pyme** que hoy lleva ventas/compras/stock en la cabeza, en un
  cuaderno o en una planilla — no alguien que ya usa un ERP formal.
- Idealmente **ya usa WhatsApp para su negocio** (hablar con proveedores,
  clientes) — coincide con el canal de mayor uso medido.
- Volumen chico-mediano: la evidencia real (27-68 mensajes/mes) es de
  negocios que registran unas pocas operaciones por día, no cientos.
- Alguien dispuesto a que se le pida feedback activo y, si el piloto va bien,
  a que se lo cite con nombre (o al menos con rubro) en el sitio — esto hay
  que pedirlo de entrada, no después.

**Evitar** para esta primera ronda: negocios que ya facturan electrónicamente
de forma compleja (el módulo de facturación de EOS todavía depende de
trámites del usuario, ver `revision-legal-brief.md` punto 4) y negocios que
necesiten integraciones bancarias que todavía no existen (ver
`eos-finanzas-integraciones`).

## Qué instrumentar desde el primer mensaje

La medición ya existe en la base (`eos_cuentas_v172`, `eos_message_usage_v40`,
`eos_action_commands`) — lo que falta es mirarla con intención de piloto, no
de operación general:

1. **Tiempo al primer valor** (alta → primera acción exitosa). Medido una
   vez: ~25 minutos en la única cuenta nueva que llegó. De 5 altas desde
   agosto, solo 1 llegó a una acción el primer día. Con el piloto, medir
   esto para cada cuenta invitada y tratar cualquier cuenta que no llegue a
   una acción en las primeras 24hs como una alerta a intervenir manualmente
   (llamar, mandar un WhatsApp), no como un dato pasivo.
2. **Verbos que fallan o caen en `GUARDAR_MEMORIA` cuando debería haber una
   acción real** (el patrón de `eos-urgencias-uso-real` y
   `eos-productos-no-se-crean-por-chat`) — revisar semanalmente, porque cada
   vez que apareció fue con una cuenta real usando el producto de verdad,
   nunca con datos de prueba.
3. **Consentimiento explícito para citar al cliente** — pedirlo antes de
   empezar, no al final, y guardarlo por escrito (un mensaje de WhatsApp o
   correo alcanza).

## Guion de onboarding (a partir de lo que ya funciona)

Ya existe onboarding por WhatsApp (`decidirBienvenida`) que ofrece empezar
anotando la primera venta, y en la web la opción "Prefiero empezar hablando
con EOS". Para el piloto, agregar un paso humano que el producto todavía no
automatiza: **un mensaje personal del propio usuario (Augusto) el primer día**,
no solo el flujo automático — con 3-10 personas es perfectamente viable y
compensa que el tiempo-al-primer-valor medido hoy es inconsistente.

## Qué recoger para marketing, no solo para producto

- Capturas de pantalla reales de conversaciones donde EOS resolvió algo
  concreto (con el nombre del cliente tapado si no dio permiso de usarlo).
- Una frase corta de cada cliente piloto sobre qué le resolvió — no pedir un
  testimonio largo, pedir la frase que diría un amigo ("ya no tengo que
  anotar nada, se lo digo por WhatsApp y listo").
- El rubro de cada cliente piloto (ej. "porcicultura", "venta de insumos") —
  sirve para casos de uso específicos en el sitio, más creíbles que un
  mensaje genérico.

## Duración y cierre

Una semana de monitoreo activo por cliente, como ya estaba decidido. Al
cierre, comparar contra la evidencia previa (n=6-7, sin instrumentar como
piloto) para ver si el tiempo-al-primer-valor y la retención a 14 días
mejoran con el onboarding humano agregado — si no mejoran, es una señal de
que el problema no es el onboarding sino el producto, y hay que mirar de
nuevo los hallazgos de `eos-urgencias-uso-real`.
