# Enrutamiento de modelo para controlar el costo de IA (punto 10)

> **Actualización del 26/09/2026:** el paso 4 ya está escrito y **apagado por
> defecto**. Ver la sección final, "Estado al 2026-09-26", para prenderlo y
> apagarlo. Lo de abajo es el diseño original del 22/09 y se deja como estaba,
> salvo dos datos que cambiaron: todo plan tiene tope (decisión del dueño), y
> el aviso interno ya no es por 400 mensajes sino por Gs. 70.000 de consumo.

**Por qué esto era solo un diseño y no una implementación (22/09):** cambiar qué
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

Los planes `Business` y `Enterprise` tienen un tope de uso alto que el cliente
no ve (todo plan tiene tope: decisión del dueño). El costo de IA por mensaje
(~USD 0,02-0,07, ver `eos-costo-por-mensaje-y-precio`) sigue siendo nuestro
hasta ese tope — el punto de equilibrio
calculado de Business ronda los ~2.600 mensajes/mes, muy por encima del uso
real actual (27-68 msgs/mes), pero un solo cliente de uso intensivo podría
cambiar esa cuenta sin que nadie lo note hasta cerrar el mes.

Ya existe un aviso interno por correo cuando una cuenta llega a Gs. 70.000
de consumo en el mes (`lib/monitoreo/uso-alto.ts`; hasta el 26/09 era a los
400 mensajes). Esto es un control de costo real, no una alarma — y a diferencia de una cláusula
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

## Estado al 2026-09-23: pasos 1 y 3 hechos, en modo sombra

El gateway quedó tranquilo (ninguna rama remota tocaba `lib/gateway/` ni
`lib/eos/procesar-mensaje.ts` al 23 de septiembre), así que se implementó la
parte que **no cambia ninguna respuesta**:

- **Paso 1, la regla:** `lib/eos/enrutamiento-modelo.ts`. Determinística, sin
  llamada extra. Más conservadora que la propuesta de arriba en un punto: una
  confirmación ("sí", "dale") **con una pregunta de EOS pendiente** queda en el
  modelo completo, porque en el flujo real ese "sí" es el que ejecuta la venta
  que EOS propuso. Solo cortesía pura y acuses sin pregunta pendiente son
  `simple`.
- **Paso 2, el corpus:** `evals/casos/enrutamiento.ts` (26 casos, 21
  críticos). Ningún mensaje del corpus de acciones puede clasificarse simple.
  Pasa 26/26.
- **Paso 3, medir sin cambiar nada:** cada mensaje deja en el log de Vercel,
  en la línea `EOS mensaje:`, el campo
  `enrutamiento: { clase, motivo, simple_con_accion }` junto a los tokens (ya
  con los cacheados del punto 8).

### Cómo leer la semana de medición

En Vercel → Logs, filtrar por `EOS mensaje:` y contar:

1. Qué parte de los mensajes es `"clase":"simple"` — el techo de ahorro.
2. Cuántos tienen `"simple_con_accion":true` — la tasa de error de la regla.
   **Tiene que ser cero.** Si aparece uno, el `motivo` dice qué clase de mensaje
   lo causó, y esa clase sale de la regla antes de enrutar nada.
3. Con los tokens de los turnos simples y la tarifa del modelo barato
   candidato, el ahorro real en USD.

### Lo que falta (paso 4) y por qué no se hizo

Enrutar de verdad: una bandera `EOS_ENRUTAR_MODELO=1` y un
`EOS_MODELO_SIMPLE=<modelo>` en `lib/gateway/conversar.ts`. No se escribió
porque (a) sin la semana de medición no hay con qué decidir, y (b) elegir el
modelo barato exige el catálogo vigente de OpenAI y correr el corpus contra
ese modelo con una clave real — nada de eso se puede hacer desde una sesión
de Code sin credenciales. Además, hoy el tráfico real pasa por n8n: enrutar
solo en el gateway TS no ahorra nada hasta prender la etapa 1 (punto 1).

## Estado al 2026-09-26: paso 4 escrito, apagado

El dueño pidió hacerlo el 26/09. Para entonces las dos trabas de arriba ya no
estaban: el gateway en TypeScript atiende en producción (`npm run go` dice qué
etapa), y la regla lleva días registrando en sombra.

### Qué hace

- `lib/eos/enrutamiento-modelo.ts` → `modeloSimple()` y `modeloDelTurno()`:
  con las dos variables cargadas, un turno que la regla clasifica `simple`
  (saludo, agradecimiento, acuse sin pregunta pendiente) va al modelo barato.
  Todo lo demás, como siempre.
- `lib/gateway/conversar.ts` → `conversar(payload, { modelo })`: le pregunta
  primero al barato y **solo usa su respuesta si es conversación pura**
  (`sirveRespuestaSimple`: sin acciones, sin documento, sin los textos de
  relleno). Si el barato pidió una acción, falló o contestó vacío, se le
  vuelve a preguntar al modelo completo **antes de mandar nada**: con el
  barato no sale ninguna operación. Un timeout del barato no se repite (ya
  gastó los 20 s) y cae a n8n, como cualquier timeout del gateway.
- `lib/eos/costo-mensaje.ts` → `tarifasDelModelo()`: el turno que contestó el
  barato se cobra a sus tarifas. Si faltan, se cobra a las del modelo completo
  (el consumo queda por arriba del real, que es el lado seguro para el aviso).
- Lo que atiende n8n no cambia: sigue con su modelo.

### Cómo se prende (en Vercel → Settings → Environment Variables)

1. Mirar primero el log. En Vercel → Logs, filtrar por `EOS mensaje:` y
   confirmar que `"simple_con_accion":true` **no aparece nunca**. Si aparece,
   no se prende: el `motivo` de esa línea dice qué clase de mensaje sale de la
   regla.
2. Elegir el modelo barato en la página de precios de OpenAI (el "mini" de la
   misma familia que el modelo actual, por ejemplo). El nombre exacto tal cual
   figura en la API.
3. Cargar:
   - `EOS_MODELO_SIMPLE` = el nombre del modelo.
   - `EOS_USD_POR_MTOK_ENTRADA_SIMPLE`, `EOS_USD_POR_MTOK_ENTRADA_CACHEADA_SIMPLE`
     y `EOS_USD_POR_MTOK_SALIDA_SIMPLE` = sus tarifas por millón de tokens.
   - `EOS_ENRUTAR_MODELO` = `1` (el interruptor).
4. Redeploy. `npm run go` tiene que decir
   "Modelo barato para mensajes simples: prendido".

### Cómo se mide que anda

En la línea `EOS mensaje:` de cada turno:

- `"modelo"`: el modelo que contestó.
- `"enrutado"`:
  - `"simple"`: lo contestó el barato.
  - `"volvio_por_accion"`: el barato pidió una acción y se descartó. Tiene que
    ser rarísimo; si se repite, la regla es demasiado amplia.
  - `"volvio_por_error"`: el barato falló. Si aparece en todos los turnos
    simples, el nombre del modelo está mal escrito. La persona igual recibe
    la respuesta del modelo completo.

La llamada descartada en `volvio_por_accion` no se suma al consumo: es una
fracción de centavo, y se supone que no pasa nunca.

### Cómo se apaga

Borrar `EOS_ENRUTAR_MODELO` (o ponerla en `0`) y hacer redeploy. Vuelve el 100 %
del tráfico al modelo completo. No hace falta tocar código ni las otras
variables.

### Lo que sigue sin hacerse

El paso 2 del diseño con el modelo barato de verdad: correr el corpus de evals
contra ese modelo con una clave real. Desde una sesión de Code no se puede, y
la red de arriba (`sirveRespuestaSimple` y la vuelta al modelo completo) es lo
que lo reemplaza mientras tanto: lo peor que puede hacer el barato con un
saludo es contestar un saludo peor.
