# Enrutamiento de modelo para controlar el costo en planes sin tope (punto 10)

**Por qué esto es solo un diseño y no una implementación:** cambiar qué
modelo responde afecta directamente la calidad de lo que el usuario recibe
— es el tipo de cambio que hay que validar con evidencia (evals) antes de
tocar producción, no algo para escribir y prender en la misma sesión.
Además, ahora mismo hay otra sesión activa trabajando código de admisión y
mensajes con imagen en el camino del gateway (`eos-admision-reserva-race`,
visible con `ListAgents` el 2026-09-22) — tocar `lib/gateway/` en paralelo
es exactamente el tipo de choque que `docs/coordinacion-sesiones.md` pide
evitar. Este documento queda listo para que una sesión futura lo implemente
cuando el gateway esté tranquilo.

## El problema que resuelve

Los planes `Business` y `Enterprise` no tienen tope de mensajes. El costo de
IA por mensaje (~USD 0,02-0,07, ver `eos-costo-por-mensaje-y-precio`) no
tiene techo del lado nuestro en esos planes — el punto de equilibrio
calculado de Business ronda los ~2.600 mensajes/mes, muy por encima del uso
real actual (27-68 msgs/mes), pero un solo cliente de uso intensivo podría
cambiar esa cuenta sin que nadie lo note hasta cerrar el mes.

Ya existe una alarma informativa a los 400 mensajes (correo interno). Esto
es un control de costo real, no una alarma — y a diferencia de una cláusula
de "uso razonable" (ver `revision-legal-brief.md`), no le cambia nada visible
al cliente.

## La idea

El modelo fijo (`gpt-5.5`, `lib/gateway/sistema.ts:23`) atiende TODOS los
mensajes por igual, desde "hola" hasta una pregunta que exige razonar sobre
el estado financiero completo del negocio. La medición ya hecha
(`eos-auditoria-seguridad-2026-09-18`) dice que buena parte de la entrada es
el prompt de sistema fijo (~8K tokens), no el pedido del usuario — así que el
ahorro real no viene de recortar el prompt (ya haría falta para todos por
igual) sino de **no pagar el modelo caro para los turnos que no lo
necesitan**.

**Candidatos a un modelo más barato** (a definir contra el catálogo vigente
de OpenAI en el momento de implementar, los nombres cambian):
- Confirmaciones simples ("sí", "dale", "confirmá").
- Preguntas de estado sin ambigüedad ("¿cuánto vendí hoy?", que ya resuelve
  una función determinística, no razonamiento).
- Saludos y conversación sin ninguna acción de negocio de por medio.

**Se queda en el modelo actual:**
- Cualquier turno que involucre decidir una acción operativa (verbo de
  negocio: vender, comprar, registrar, anular).
- Cualquier turno donde el usuario está en el flujo de honestidad/conciliación
  financiera (`lib/finanzas/conciliacion.ts`) — es, por diseño, el momento
  donde EOS no puede permitirse una respuesta de menor calidad.

## Cómo probarlo sin arriesgar calidad

1. **No enrutar por adivinar la intención del usuario con otro modelo** —
   eso agrega una llamada extra y un punto de falla. Enrutar por **una regla
   determinística barata** sobre el mensaje entrante (longitud, si matchea un
   patrón de confirmación conocido, si el turno anterior dejó una pregunta de
   sí/no pendiente) — el mismo tipo de heurística que ya usa
   `corregirAfirmacionSoloMemoria` para otro problema.
2. **Correr el corpus de evals (`evals/`) con el modelo barato** sobre los
   casos que la regla clasificaría como "simple", antes de tocar producción.
   Si algún caso del corpus baja de calidad, esa clase de mensaje no entra a
   la regla.
3. **Medir en producción sin cambiar el comportamiento primero**: loguear qué
   modelo HABRÍA atendido cada mensaje real durante una semana, sin cambiar
   nada, y confirmar cuánto costo se ahorraría de verdad antes de comprometerse.
4. Bandera de apagado inmediato (mismo patrón que el gateway TS): si la regla
   falla o el modelo barato da una mala respuesta, un único interruptor
   vuelve todo al modelo actual para el 100% del tráfico.

## Por qué no es la primera prioridad de costo

El punto 8 del plan de fortalecimiento (corregir `costo_estimado_usd` para
que use el descuento real de caché) es más urgente: hoy ese número
**sobreestima el costo real ~2,3 veces**, así que cualquier decisión de
enrutamiento tomada sobre el dato actual estaría optimizando contra un
número inflado. Corregir la medición primero, decidir el enrutamiento
después.
