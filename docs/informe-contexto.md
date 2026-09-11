# Qué recibe el modelo antes de contestar

Fecha: **10 de septiembre de 2026**. Medido contra la base de producción y
contra n8n reales, sobre tres usuarios distintos.

El encargo pedía una auditoría profunda de todo lo que el modelo recibe antes
de responder. Es el frente que más importa después de los verbos: los 26 que
EOS puede ejecutar dependen de que elija bien, y elige con lo que recibe.

---

## 1. El agujero

`eos_contexto_negocio` le mandaba al modelo el catálogo, las ventas, la
cartera, las oportunidades y los totales del mes —de los dos ámbitos— y **nada
de la posición de la persona**. Ni cuentas, ni tarjetas, ni deudas, ni
objetivos.

Comprobado llamando a la función para tres usuarios reales: los tres iguales.

El ciclo del producto es observar, entender, ejecutar y volver a entender. Se
cortaba justo después de ejecutar: **la persona le cuenta algo a EOS, EOS lo
escribe bien, y en el mensaje siguiente ya no lo sabe.** Es lo que se siente
como "el asistente se olvida de todo", y es peor que olvidar — EOS acababa de
escribir ese dato, con su nombre y su fecha.

Y se agrandaba solo: los seis verbos del 9 y 10 de septiembre —saldos,
tarjetas, compras en cuotas, cobros, oportunidades— escriben exactamente ahí.

## 2. Lo que ahora viaja

Un bloque `posicion` con cuentas, tarjetas, deudas y objetivos. Con topes —8,
5, 8 y 5— porque esto va en **cada** mensaje.

Escrito así:

```
Lo que tenés (VOS, según lo que declaraste):
  ₲ 3.500.000 en total: Ueno ₲ 3.000.000 (10/09), Efectivo ₲ 500.000 (01/09)
Sus tarjetas:
  Visa — vence el 5, cierra el 20, resumen ₲ 1.850.000 del 05/09
Lo que debe (VOS, personal):
  Financiera Ueno: ₲ 8.000.000, cuota ₲ 800.000 el 10
Lo que quiere lograr:
  terreno: ₲ 30.000.000 para el 31/12 (lleva ₲ 5.000.000)
```

Tres reglas, con prueba cada una:

**El total se calcula acá, por moneda.** Si fueran solo los renglones sueltos
el modelo sumaría — y sumaría también los dólares con los guaraníes, que es el
error más caro posible sobre estos datos. Hay una prueba que exige que no
aparezca ningún número que sea la suma cruzada.

**Cada saldo con su fecha.** Un saldo declarado hace tres semanas no es el de
hoy, y sin la fecha al lado el modelo lo presenta como el actual.

**Lo que no está cargado no se escribe.** Una cuenta sin saldo entraría como
"₲ 0" y el modelo lo leería como que no tiene nada. Un saldo en cero sí entra:
eso es un dato.

### Verificado hablando

```
> ¿cuánta plata tengo en mis cuentas y cuándo vence mi tarjeta?

Tenés ₲ 3.000.000 declarados en tu cuenta ZZ Ueno, al 10/09.
Tu tarjeta ZZ Visa vence el día 5 de cada mes.
```

"Declarados… al 10/09": la regla de la fecha sobrevivió hasta la respuesta, que
es donde tenía que llegar.

### Latencia

El piso de red desde esta máquina es ~200 ms y la llamada completa da 218 ms de
mediana. **Las cuatro consultas nuevas no cuestan nada medible.**

---

## 3. Dos errores míos, y valen más que el arreglo

### La sonda no mandaba contexto

La herramienta con la que venía hablándole a EOS mandaba
`contexto_negocio: ""`. Con eso, cualquier pregunta sobre la plata de la
persona se contesta con "no puedo ver eso desde acá" — y no porque el producto
esté roto, sino porque la sonda no le mandó nada que ver.

Cité una de esas conversaciones como prueba del agujero. La conclusión era
correcta y estaba comprobada por otro lado —la función no devolvía la posición,
verificado para tres usuarios— pero **esa evidencia no servía**. Casi doy por
cierta una conclusión falsa sobre producción.

`scripts/sonda-chat.mts` arma ahora el mismo contexto que
`app/api/eos/route.ts`, y lo imprime antes de mandarlo.

### Dos sesiones, el mismo timestamp, y el catálogo borrado

Otra sesión y ésta escribieron, sin saberlo, dos migraciones distintas con el
mismo timestamp `20260910180000`: una agrega el catálogo, la otra la posición.
Las dos reescribían la función entera, cada una sin el bloque de la otra.

La del catálogo se aplicó primero y anotó la versión. Entonces
`supabase db push` empezó a contestar **"Remote database is up to date"** a la
otra —mismo número, ya aplicada— y el cuerpo con la posición nunca llegó. El
CLI no dijo una palabra.

Salí del paso con una v159 que volvía a declarar la función. Como estaba
generada desde el archivo **sin** catálogo, **borró el catálogo de producción**.
Una usuaria real se quedó sin sus 15 productos en el contexto durante unos
minutos.

Se detectó llamando a la función contra producción. **El historial de
migraciones decía que todo estaba bien.**

`npm run migraciones` ya tenía escrito el control que encuentra esto —existe
desde el 2 de septiembre, por dos choques del mismo día— y lo gritó apenas los
dos archivos convivieron en el árbol. Lo que falló no fue el control: fue
empujar a producción antes de traer lo del otro.

La v160 se genera desde el archivo del catálogo y le injerta el bloque de la
posición, en ese orden a propósito.

---

## 4. Lo que sigue abierto en este frente

**El modelo no consulta, solo recibe.** Todo esto es contexto empujado. No hay
forma de que pregunte "¿cuánto vendí en agosto?" — eso son los *tools*
deterministas, y dependen de sacar el gateway de n8n.

**~~El tope no está medido.~~ Medido.** Con la peor carga realista —8 cuentas,
5 tarjetas, 8 deudas y 5 objetivos— el contexto llega a 1.286 caracteres, muy
dentro de lo sano. El que pesa es el **prompt**: 22.941 caracteres, dieciocho
veces más, y creció 42% en dos días. `scripts/medir-contexto.mts` lo desglosa.

**~~La memoria no se auditó.~~ Cerrado**, y con hallazgo: para un usuario real
el bloque ENTERO de memoria eran tres preguntas suyas devueltas como hechos.
Está en `docs/auditoria-general.md`.

**~~El briefing sigue sin Personal.~~ Hecho**, y era peor de lo que decía esta
línea: el briefing no sabía una sola cifra de plata, ni del negocio ni de la
persona. Ahora lleva el mes por ámbito, lo declarado con su fecha, las deudas
con su cuota y las tarjetas con su vencimiento. Lo que todavía no se puede
juzgar es el **texto** que escriba el modelo: eso se ve cuando corra el cron.
