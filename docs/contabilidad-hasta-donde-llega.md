# Hasta dónde llega EOS con los números del negocio

Este documento existe para que nadie "arregle" más adelante lo que acá está
deliberadamente sin hacer.

La fase 9 del plan prometía encender balance, estado de resultados, EBITDA,
ROE, ROA, liquidez y solvencia. Se construyó **la parte que se puede afirmar**
y se dejó afuera el resto. Lo que sigue dice exactamente cuál es cuál y qué
haría falta para mover la línea.

## La regla que manda

`docs/erp-profesional-arquitectura.md` ya había decidido dos cosas:

> **Fuera del MVP:** … contabilidad de libro mayor completa.

> Importación contable: … **EOS no debe inventar equivalencias tributarias**.

No se contradicen acá. Construir un plan de cuentas y asientos habría sido ir
en contra de una decisión ya tomada, y en el terreno donde equivocarse sale
más caro: un criterio contable mal puesto no se nota, se acumula, y aparece
recién cuando alguien presenta una declaración.

## Lo que SÍ se calcula

| Qué | Dónde | Con qué |
|---|---|---|
| Ventas netas de IVA | `lib/contabilidad/resultado.ts` | Ítems de venta, cada línea con su tasa |
| Costo de lo vendido | idem | Kardex valorizado (v108) |
| Resultado bruto y operativo | idem | Lo anterior menos gastos anotados y fijos |
| Margen operativo | idem | Sobre venta neta, nunca sobre el total facturado |
| Cuentas por cobrar y por pagar | `lib/contabilidad/posicion.ts` | Cartera (v107) |
| Inventario valorizado | idem | Kardex (v108) |
| Deuda a doce meses | idem | Deudas declaradas |
| Capital de trabajo | idem | Activo conocido − pasivo conocido |
| Liquidez (como **piso**) | idem | Lo mismo, dividido |

## Lo que NO se calcula, y qué haría falta

### EBITDA · falta un registro de activos fijos

EBITDA es el resultado **antes de depreciar**. Para calcularlo hay que saber
qué se deprecia, desde cuándo, por cuántos años y con qué método. EOS no
guarda ningún activo fijo: no hay tabla, no hay altas, no hay vida útil.

**Para encenderlo:** un registro de bienes de uso con fecha de alta, valor y
criterio de amortización. Y el criterio es tributario, así que lo define un
contador, no este repositorio.

### Intereses · falta la composición de la cuota

`eos_finanzas_deudas` guarda `cuota_monto` y a veces `tasa_anual`, pero no el
sistema de amortización ni el saldo al día. Separar interés de capital con
`saldo × tasa / 12` daría un número que parece exacto y no lo es, sobre un
`saldo_declarado` que puede tener meses.

**Para encenderlo:** o el detalle de la cuota como lo emite el banco, o la
tabla de amortización del préstamo.

### Impuestos y utilidad neta · son equivalencias tributarias

Ver la regla de arriba. Sin la línea de impuestos no hay utilidad neta, y por
eso el estado de resultados **se corta en el operativo** — el corte es la
decisión, no una limitación que quedó pendiente.

### ROE y ROA · falta el patrimonio

Los dos se dividen por patrimonio o por activo total. EOS no tiene cuenta de
capital, ni aportes, ni resultados acumulados, ni el saldo de caja. Las dos
cifras serían inventadas.

Y este es el caso más peligroso de todos, porque **un ROE falso se ve idéntico
a uno verdadero**. Nadie lo audita: se lo mira, se decide, y listo.

**Para encenderlo:** patrimonio inicial declarado, aportes y retiros
registrados, y resultados acumulados período a período. Es decir, casi un
libro mayor — que es justamente lo que está fuera de alcance.

### Prueba ácida · el dato que falta es el que más pesa

La prueba ácida saca el inventario del activo corriente. Como el otro dato que
falta es la caja, el ratio quedaría armado casi solo con cuentas por cobrar:
sería el número menos confiable de todos, presentado como el más exigente.

**Para encenderlo:** alcanza con el saldo de caja y bancos.

## El dato que desbloquea más por menos

**El saldo de caja y bancos del negocio.**

Con ese único dato:

- la liquidez corriente deja de ser un piso y pasa a ser el número real;
- la prueba ácida se puede calcular;
- el pronóstico de caja (`lib/pronostico/caja.ts`) deja de decir "no se
  conoce el disponible" y puede avisar qué día se cae la caja.

Hoy no existe porque `eos_finanzas_cuentas` es del lado personal, y meter la
caja personal en el resultado del negocio sería cruzar la frontera que todo el
resto del sistema respeta. Lo que falta es una caja **de la empresa**, con su
`empresa_id`, no reutilizar la que hay.

## Qué NO hacer

- No estimar la depreciación con una vida útil "típica".
- No partir la cuota en interés y capital con una fórmula aproximada.
- No calcular ROE con el resultado acumulado como si fuera patrimonio.
- No mostrar la liquidez sin la palabra "al menos".
- No sacar la advertencia de que esto no sirve para la SET.

Cada una de esas cinco cosas produce un número que se ve bien y está mal, y la
diferencia entre los dos casos no se puede ver en pantalla.
