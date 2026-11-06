# Multiagente — diseño antes de tocar código (06/11/2026)

Punto 01 del documento EOS 2030 ("IA multiagente: agentes especializados en
finanzas, operaciones, inventario, investigación y auditoría, coordinados por
un agente principal"), elegido por el dueño para dedicarle la sesión a
diseñarlo en serio, no a improvisarlo.

## 1. De dónde parte EOS hoy, medido

No es una opinión, son números de este repo:

- **Un solo prompt de sistema, de 52.091 caracteres**, en
  `lib/gateway/sistema.ts`. Se manda ENTERO en cada mensaje, sin importar de
  qué habla — alguien preguntando "¿cuánto gasté este mes?" paga por las
  reglas de ventas, compras, stock, CRM, tarjetas, documentos y búsqueda web
  que no va a usar en ese turno.
- **33 tipos de acción distintos** (`REGISTRAR_VENTA`, `AJUSTAR_STOCK`,
  `REGISTRAR_DEUDA`, `CREAR_CONTACTO`, `BUSCAR_WEB`...), todos en la lista
  blanca del mismo modelo, en la misma llamada.
- **Un solo modelo decide todo**, con enrutamiento por COSTO/complejidad
  (`lib/eos/enrutamiento-modelo.ts`, GPT 6 Sol vs GPT 5.5 — ver
  [[eos-modelo-sol-y-55]]), no por DOMINIO. Hoy no existe ninguna noción de
  "esto es una pregunta de finanzas personales" vs "esto es del negocio".

## 2. El riesgo que ya mordió a este producto, y que un diseño ingenuo empeora

[[eos-n8n-gateway]] (memoria del 07/09) documenta que dar de alta UNA acción
nueva requerís tocar, históricamente, hasta siete lugares distintos entre n8n
y la base — y que la lista blanca que se olvida (`allowed` del worker) **no
da error visible**: el gateway llama, espera, recibe `{}`, y el chat actúa
como si la acción se hubiera ejecutado. Pasó dos veces (31/08 y 07/09).

Es la misma familia de bug que esta sesión ya investigó a fondo para el
[[eos-chat-ejecuta]] (Proof Engine): "EOS entiende y no registra" casi nunca
fue el modelo razonando mal — fue una lista desincronizada en algún lado.

**Si "multiagente" significara literalmente N agentes autónomos, cada uno con
su propia lista de acciones permitidas y su propio camino de ejecución, el
problema de las N listas desincronizadas se multiplica por N.** Sería
construir exactamente el tipo de superficie que ya causó incidentes reales,
a propósito, en nombre de seguir el documento al pie de la letra. Eso no es
lo que el documento pide — pide "especialización", no "fragmentación", y el
propio ítem 15 del mismo documento (EOS Proof Engine) exige que CUALQUIER
acción termine verificada contra lo que de verdad pasó, sin importar cuántos
"agentes" la pidieron.

## 3. Lo que SÍ vale la pena construir: especializar el razonamiento, no el
   camino de ejecución

La pieza de infraestructura más cara y mejor probada de EOS hoy no es el
modelo — es el camino de verificación: `verificarAcciones` →
`respuestaTrasVerificar` → la transacción atómica de
`eos_execute_internal_effect_v64` → el trigger de `eos_auditoria_v60`. Eso
tiene que seguir siendo UNO SOLO, lo pida quien lo pida.

Lo que sí puede (y conviene) especializarse es **qué parte del prompt de
52K caracteres ve el modelo en cada turno**, y opcionalmente **qué modelo
responde cada parte**. Es la misma idea del Model Router (ya construido,
ya medido en 98,6 % de acierto) aplicada a un eje distinto: no "qué tan
difícil es esto", sino "de qué dominio es esto".

### El precedente que ya funciona: `con-busqueda.ts`

`BUSCAR_WEB` YA es, en los hechos, un "agente especializado en
investigación" — en el sentido correcto del término: el modelo principal
pide la búsqueda, un módulo aparte (`lib/busqueda/investigar.ts`) la
ejecuta aislado, y el MISMO modelo principal sintetiza el resultado con el
resto de la conversación. Nunca hay un segundo camino de ejecución, nunca
hay una segunda lista de acciones permitidas: las acciones que la síntesis
proponga se TIRAN (`sinAccionesDelGateway`). Es la prueba de que
"especializar sin fragmentar" ya es un patrón que EOS sabe hacer bien.

## 4. Propuesta: Router de Dominio + Prompt Compuesto

```
Mensaje del usuario
        │
        ▼
  Clasificador de dominio (barato, determinístico primero)
        │
        ├─ ¿Toca finanzas personales?  → módulo "personal"
        ├─ ¿Toca negocio/ERP?          → módulo "negocio"
        ├─ ¿Toca CRM?                  → módulo "crm"
        ├─ ¿Toca documentos?           → módulo "documentos"
        └─ (siempre) núcleo compartido: identidad, formato JSON,
           Contexto Maestro, memoria, verificación
        │
        ▼
  Prompt COMPUESTO (núcleo + solo los módulos que aplican)
        │
        ▼
  UN SOLO modelo, UNA SOLA llamada, UNA SOLA lista de acciones activas
  (la unión de las de los módulos incluidos — sigue viviendo en
  ACCIONES_INTERNAS / SYSTEM_RISK, sin un segundo registro)
        │
        ▼
  El camino de verificación y ejecución de SIEMPRE, sin cambios
```

Un mensaje que cruza dominios ("vendí 3 remeras y pagá el alquiler con lo
cobrado") compone los dos módulos en el mismo prompt y en la misma llamada
— no dos llamadas a dos agentes que después hay que coordinar. Coordinar
dos respuestas independientes de dos modelos distintos sobre la MISMA
transacción (vender y pagar con lo cobrado) es exactamente el tipo de
problema de concurrencia/orden que `lib/gateway/worker.ts` ya resuelve hoy
mandando los jobs "de a uno y en orden" — fragmentarlo en agentes
paralelos lo reintroduciría.

### Por qué el clasificador debería ser barato y determinístico primero

La mayoría de los mensajes de EOS ya se clasifican solos por vocabulario:
"vendí", "stock", "compré a crédito" → negocio; "mi tarjeta", "el alquiler",
"ahorrar" → personal. Un clasificador por reglas/keywords (como ya existe
`elegirModelo` para dificultad) alcanza para la mayoría de los casos sin
gastar una llamada a un LLM aparte. Solo el resto —ambiguo, o que mezcla
dominios— necesita que el MISMO modelo vea el mensaje con el núcleo
completo (fallback seguro: si no se puede clasificar con confianza, se
manda el prompt completo de hoy, nunca uno recortado por error).

## 5. Fases, en orden de riesgo creciente

1. **Medir antes de tocar nada.** Instrumentar cuánto del prompt de 52K
   caracteres es realmente necesario por mensaje, sobre tráfico real o
   sobre la batería de evals ya existente (`evals/bateria`). Esto solo ya
   puede justificar el proyecto en términos de costo/latencia sin haber
   cambiado una línea de producción.
2. **Partir el prompt en módulos, sin cambiar el comportamiento.** Refactor
   puro: `PROMPT_SISTEMA` pasa a ser `nucleo + personal + negocio + crm +
   documentos`, pero el gateway sigue componiéndolos TODOS siempre — cero
   riesgo, con un test que compara la concatenación contra el texto actual
   carácter por carácter, para no perder una regla en el camino.
3. **Clasificador de dominio + composición selectiva, detrás de una
   bandera.** Recién acá se empieza a mandar menos que el prompt completo,
   medido contra la batería existente antes de tocar producción (mismo
   criterio que ya se usó para medir el Model Router: 98,6 % de acierto
   antes de confiar en él).
4. **Solo si 1-3 no alcanzan:** considerar una segunda llamada a un modelo
   realmente separado para un dominio concreto (auditoría es el candidato
   más razonable, porque ya es una tarea de "mirar después", no de actuar
   en el momento) — nunca con su propio camino de ejecución.

## 6. Lo que este diseño explícitamente NO hace

- No crea una segunda lista de acciones permitidas en ningún lado.
- No le da a ningún "agente" su propio camino de escritura a la base: sigue
  habiendo UNA función (`eos_execute_internal_effect_v64`) y UN trigger de
  auditoría.
- No reemplaza el Model Router por dificultad — lo complementa con un eje
  de dominio, no lo sustituye.
- No promete agentes "silenciosos" corriendo solos: cada especialización
  sigue respondiendo DENTRO del mismo turno que el usuario inició, con el
  mismo criterio de autonomía por niveles que ya rige todo lo demás.

## 7. Lo que la Fase 1 midió, y por qué cambia el plan (06/11, mismo día)

Se construyó `lib/gateway/prompt-modulos.ts` (extrae el núcleo del prompt
real, sin copiarlo a mano — ver el comentario largo del archivo) y se
midió contra los 216 casos reales de `evals/bateria/frases.ts`, sin llamar
a ningún modelo:

- El núcleo es **26,2 % más chico** que el prompt completo (38.469 contra
  52.091 caracteres) cuando se excluyen las acciones exclusivas de
  ERP/CRM.
- Pero el clasificador por palabras clave (`necesitaModuloErpCrm`) falla
  en **76 de 216 casos (35 %)**: frases reales como *"salió 1 balanceado
  a 180"*, *"me quedan 2 conjuntos verdes"*, *"le pagué a Agro Sur"* o
  *"osẽ 10 varilla ko'ẽme"* (jopará) no tienen ninguna palabra de la lista
  ("vendí", "cliente", "stock"...) y el clasificador las clasificaría como
  "no hace falta el módulo de negocio" — exactamente al revés de lo
  correcto.

**Conclusión, sin vueltas: un clasificador barato por palabras clave NO es
seguro para este idioma y este dominio.** Es la misma razón por la que el
prompt de 52K caracteres existe: el habla real de una PyME paraguaya —
colloquial, con jopará, sin vocabulario de manual— es exactamente lo que
un filtro de palabras no puede capturar. Confirmarlo con datos reales,
antes de prenderlo, es lo que la Fase 1 existe para hacer.

### El pivote: gatear por lo que la cuenta YA tiene, no por lo que el mensaje parece decir

Hay un eje que SÍ es 100 % confiable, porque no es una suposición: **si la
cuenta no tiene el módulo `erp` contratado, ninguna acción de ese módulo
puede ejecutarse** — `exigirModulo("erp")` ya lo bloquea del lado del
servidor en cada ruta. Para esas cuentas, incluir las instrucciones de
`REGISTRAR_VENTA`, `AJUSTAR_STOCK`, etc. en el prompt no tiene ningún
costo de riesgo porque NUNCA hacía falta — no es una clasificación, es un
hecho ya conocido sin adivinar nada.

Este eje es más angosto que "todo mensaje personal ahorra" (una cuenta con
el módulo ERP contratado sigue mandando el prompt completo siempre, sin
excepción, hasta que exista una forma confiable de clasificar POR
MENSAJE), pero es seguro de verdad, hoy, sin esperar nada más.

## Próximo paso

Confirmar con el dueño si se construye el gate por módulo contratado (el
pivote de la sección 7) como la Fase 3 real, en lugar del clasificador por
palabras clave original (descartado por la medición). Es un cambio de plan
basado en datos, no una vuelta atrás: la Fase 1 hizo exactamente lo que
tenía que hacer.
