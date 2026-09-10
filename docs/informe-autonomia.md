# Qué pasó con la autonomía de EOS

Fecha: **9 y 10 de septiembre de 2026**. Todo lo de acá está aplicado en
producción y verificado contra la base y contra n8n reales.

El encargo era seguir con P7: la auditoría sistemática de los verbos que una
persona espera poder pedirle a EOS, cerrando cada uno por **el circuito
completo** —prompt, forma de datos, lista blanca del 05, paths del 06,
allowlist del worker, `SYSTEM_RISK`, los tres check de la base, la rama del
ejecutor, la traducción del error— y probándolo de punta a punta.

---

## 1. Lo que estaba mal, y no lo sabía nadie

### El monto con punto de miles entraba mil veces más chico

Once funciones vivas leían los montos que manda el chat con el mismo texto:

```sql
nullif(regexp_replace(coalesce(p_datos ->> 'monto', ''),
       '[^0-9.]', '', 'g'), '')::numeric
```

Esa expresión deja pasar el punto. En Paraguay el punto es el separador de
**miles**:

| Lo que llega | Lo que Postgres lee |
|---|---|
| `"800.000"` | **800** |
| `"3.000.000"` | error de sintaxis, la acción muere |

El primero es el grave, porque **no falla**. Entra un gasto de ochocientos
guaraníes donde la persona dijo ochocientos mil, la confirmación dice "listo",
y el panel del mes queda mil veces por debajo sin una sola señal.

Apareció probando otra cosa: la prueba de `DECLARAR_SALDO` le mandó el monto
como lo escribe una persona.

**Por qué nunca se disparó, y por qué igual se arregló.** Se miraron los
comandos reales de producción: en todos, el modelo mandó el monto como *número*
de JSON, no como texto. Con un número no hay separadores y la expresión
acierta. Pero está a un cambio de modelo o a un ajuste de prompt de dispararse,
y cuando lo haga no va a haber ningún error que lo delate. Un sistema cuyo peor
fallo es silencioso y de tres órdenes de magnitud no se apoya en que el
proveedor siga eligiendo el mismo tipo de dato.

**De regalo:** la expresión vieja borraba el signo menos, así que los guardas
`if v_monto <= 0 then raise` de todas esas funciones **no podían dispararse
nunca**. Estaban escritos y no protegían nada.

### El embudo se pegaba a la oportunidad equivocada

La primera versión de `REGISTRAR_OPORTUNIDAD` decía: si el contacto tiene UNA
sola abierta y el título no se parece a ninguna, avanzá esa igual.

Su propia prueba mandó *"ZZ interesado en algo"* para un contacto que tenía
abierta *"ZZ mantenimiento anual"*. Nada en común. Y se pegó a ella — y le dejó
el título viejo, así que la confirmación decía el nombre de la otra y el
negocio nuevo nunca entraba.

### La base le escribía la plata a la persona con formato de otro país

`to_char(..., 'FM999G999G999G999D99')` usa el *locale* del servidor: agrupa con
coma y separa decimales con punto. El mensaje salía **`60,000.`** donde tenía
que decir `₲ 60.000`.

Este proyecto ya pagó cuatro fugas de la regla "la plata se formatea en un solo
lugar". Ahora la base manda `MONEDA|numero` y el formato se aplica donde vive,
`lib/finanzas/formato.ts`.

### El prefijo del código de error no era decorativo

Hay una prueba que exige traducción para toda excepción `EOS_ACCION_*` de las
migraciones. Los códigos nuevos de cobranza se llamaban `EOS_COBRANZA_*` y
quedaban **fuera del barrido**: se podían olvidar sin que nada avisara, y
volverían al 500 genérico con "no pude" y nada más.

---

## 2. Los seis verbos nuevos

EOS pasó de 20 acciones a 26. Cada una recorrió los nueve lugares.

| Verbo | Lo que la persona dice |
|---|---|
| `DECLARAR_SALDO` | "tengo 3 millones en Ueno" |
| `REGISTRAR_COBRO` | "María me pagó la factura" |
| `REGISTRAR_PAGO_COMPRA` | "le pagué al proveedor de balanceado" |
| `REGISTRAR_TARJETA` | "mi Visa cierra el 20 y vence el 5" |
| `REGISTRAR_COMPRA_TARJETA` | "compré la heladera en 6 cuotas de 500 mil" |
| `REGISTRAR_OPORTUNIDAD` | "Pedro está interesado, unos 5 millones" |

**Ninguno estrenó motor.** Las cuentas, la cuenta corriente con cobros
parciales, la vertical de tarjetas y el embudo estaban construidos y probados.
Lo único que faltaba era la forma de hablarles.

### Las reglas que los hacen confiables

Cada uno tiene una regla que vale más que su código:

**El saldo no se escribe en la cuenta equivocada.** Con dos cuentas parecidas
`DECLARAR_SALDO` **no elige**: es la única acción del sistema que se niega a
desempatar sola. Un saldo mal puesto deja mal el patrimonio, el disponible y la
cobertura a la vez, y los dos números quedan plausibles.

**El tipo de institución no se supone.** Quien dice "tengo 3 millones en Ueno"
no dijo si Ueno es un banco o una financiera. La cuenta se crea **sin
clasificar** y la confirmación lo ofrece en una línea.

**La cobranza imputa de la más vieja a la más nueva**, en cascada, y dice a
cuáles fue. Nunca suma monedas distintas. Nunca cobra de más: un monto mayor a
la deuda es casi siempre un cero de más al escribir, y el saldo negativo
resultante no se parece a un error, se parece a un anticipo.

**Comprar con tarjeta NO es un gasto del mes.** Lo que sale del bolsillo es el
pago del resumen. Si "compré la heladera en 6 cuotas de 500 mil" entrara como
movimiento personal, la persona vería 3.000.000 el día de la compra y otra vez
500.000 cada mes: la misma plata contada siete veces. Hay una comprobación
explícita de que no se escribió ningún movimiento financiero.

**Ganar una oportunidad NO es vender.** Son dos hechos distintos, a veces con
días de diferencia. La confusión es de una sola dirección y cara: el negocio se
quedaría sin la venta, sin el descuento de stock y sin el ingreso.

**Lo estimado se declara estimado.** Cuando solo dan el total de una compra en
cuotas, la cuota se divide *y se dice que es estimada*: con intereses la real
es más alta, y una cuota estimada se ve idéntica a una declarada.

**Lo que falta se dice.** Una oportunidad sin monto entra igual, en cero, y la
confirmación lo pide. Un embudo con huecos es honesto; uno con montos
inventados se lee como una previsión de ingresos.

---

## 3. Lo que se verificó, y cómo

Cada verbo se probó **dos veces**: contra la función de la base con datos
reales, y después hablando con EOS contra n8n y Vercel de producción.

### Contra la base

| | Comprobaciones |
|---|---|
| `eos_leer_monto` | 17 |
| Las funciones reescritas por la v150 | 6 |
| `DECLARAR_SALDO` | 30 |
| Cobro (venta) | 12 |
| Pago a proveedor (compra) | 19 |
| Tarjetas | 27 |
| Oportunidades | 21 |

### Hablando, contra producción

> **"tengo 3 millones en la cuenta ZZBanco Prueba"**
> *Anoté ₲ 3.000.000 en ZZBanco Prueba. Cuenta nueva.*

> **"me equivoqué, en ZZBanco Prueba tengo 1.200.000"**
> *ZZBanco Prueba pasó de ₲ 3.000.000 a ₲ 1.200.000.*
> (y eligió `DECLARAR_SALDO`, no `CORREGIR_MOVIMIENTO`, pese al "me equivoqué")

> **"en ZZBanco tengo 500 mil"** — con dos cuentas parecidas
> *Tenés más de una cuenta que se parece: ZZBanco Prueba, ZZBanco Prueba Dos.
> ¿En cuál lo anoto?*

> **"ZZ Rossana Prueba me pagó la factura"** — con tres abiertas
> *Tiene 3 facturas abiertas: 21/08 por ₲ 20.000, 31/08 por ₲ 10.000, 07/09 por
> ₲ 30.000. ¿Cuál te pagó, o cuánto te dio?*

> **"me dio 25 mil ZZ Rossana Prueba"**
> *Cobré ₲ 25.000. Saldó la del 21/08 y el resto quedó a cuenta de la del
> 31/08. Le quedan ₲ 35.000.*

> **"ZZ Rossana Prueba me pagó 5 millones"**
> *Eso es más de lo que te debe: son ₲ 15.000 en total.*

> **"le pagué 400 mil a ZZ Distribuidora Prueba"**
> *Pagué ₲ 400.000 a ZZ Distribuidora Prueba. Va a cuenta de la del 05/09. Te
> quedan ₲ 500.000.*

> **"compré la heladera en 6 cuotas de 500 mil con la ZZ Visa"**
> *Anoté heladera: 6 cuotas de ₲ 500.000 en ZZ Visa del Itau. **No es un gasto
> de este mes: sale cuando pagues el resumen.***

> **"puse la notebook a 4.800.000 en 12 cuotas con la ZZ Visa"**
> *Anoté notebook: 12 cuotas de ₲ 400.000. **La cuota la saqué del total
> dividido 12; si con los intereses es otra, decímela.** No es un gasto de este
> mes.*

> **"ZZ Pedro Prueba está interesado en el sistema de gestión, unos 5
> millones"**
> *Anoté Sistema de gestión con ZZ Pedro Prueba por ₲ 5.000.000.*

En cada caso se miró la base después: la cartera quedó exacta tras cada cobro,
las dos primeras facturas en estado `cobrada`, la cuenta con su ámbito personal
y su fecha, y **ningún movimiento financiero** por las compras con tarjeta.

Todos los datos de prueba se borraron.

---

## 4. Lo que sigue incompleto

**Cuatro verbos.** En `docs/autonomia/verbos.md`, con el orden y el motivo:

1. **Anular y corregir una venta del negocio.** `eos_erp_anular_venta` y
   `eos_erp_editar_venta` existen y son transaccionales. Es el grupo más
   delicado que queda: un `anular` por chat sobre la venta equivocada revierte
   stock y plata.
2. **Registrar una decisión.** `eos_decisions` y su verificación de resultados
   están cableadas y se llenan solo desde n8n.
3. **El movimiento de dos lados** — "saqué 2 millones del negocio para mí".
   Hoy se anotaría como ingreso personal y el negocio no se enteraría. Es el
   único de los cuatro que no tiene motor: el concepto de "retiro del dueño" no
   existe en el libro del negocio.
4. **Borrar un movimiento**, que a propósito no se va a hacer: borrar por chat
   es la única operación donde una coincidencia equivocada destruye un dato sin
   dejar rastro.

**Lo que `DECLARAR_SALDO` todavía no dice.** *"Declaraste 3.000.000 y yo venía
calculando 3.450.000"* es la frase más útil que puede decir ese verbo, y
requiere llevar el arrastre de `lib/empresa/caja.ts` al lado de la base.

**El E2E maestro (P9).** Registro, confirmación, recuperación de contraseña,
dos usuarios simultáneos, refresh durante una ejecución, doble clic. Necesita
cuentas de QA que hoy no existen.

**El recorrido visual de Personal**, de la sesión anterior. Sigue sin mirarse.

---

## 5. Qué riesgo queda

**Alto — ninguno conocido.**

**Medio.**
- Las frases del worker viven en JavaScript dentro de n8n y **no tienen
  pruebas**. `verificarFlujo` comprueba que compilan, no que digan lo correcto.
  Es como salió "Cerró 1 facturas" a producción: lo encontró una conversación
  real, no el CI.
- El gateway en TypeScript sigue detrás de su bandera. Las tres listas ahora se
  derivan del prompt con un candado, pero el camino entero nunca atendió
  tráfico real.

**Bajo.**
- `eos_leer_monto` interpreta `1.500` como mil quinientos siempre. Es correcto
  en guaraníes y para cualquier moneda donde nadie escribe "1.500" queriendo
  decir uno y medio, pero es una convención, no una certeza.
- Las tres cuentas del check de acciones (`eos_action_commands`,
  `eos_autonomy_rules_v12`, `eos_worker_gate_audit_v15`) se reescriben enteras
  en cada migración que agrega un verbo. Es repetitivo y una omisión se vería
  al instante, pero es la clase de duplicación que envejece mal.

---

## 6. Estado exacto

| | |
|---|---|
| Acciones que EOS puede ejecutar | **26** (eran 20) |
| Migraciones | 244 |
| Pruebas | 1308, en verde |
| Candados de CI | 8, todos bloqueantes, en verde |
| `tsc --noEmit` | limpio |
| `npm run build` | compila |
| Verbos de la auditoría cerrados | 5 de 9 |

---

## 7. GO / NO-GO

**Para los seis verbos nuevos: GO.** Están probados contra la base y contra
producción hablando, cada uno se niega a adivinar donde adivinar sería caro, y
cada uno dice lo que hizo con el número real.

**Para el conjunto: sigue NO-GO hasta P9**, por lo mismo que la vez pasada. No
por lo que falta construir, sino por lo que falta probar: nadie recorrió todavía
un registro, una recuperación de contraseña ni dos usuarios simultáneos.

**Y una condición nueva:** las frases del worker necesitan pruebas. Seis verbos
nuevos son seis frases nuevas escritas en JavaScript sin red, y ya se vio que un
error ahí llega a producción y solo lo encuentra alguien conversando.
