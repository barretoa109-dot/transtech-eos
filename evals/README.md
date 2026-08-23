# Suite de evals

```bash
npm run evals            # corre el corpus completo
npm run evals:mutacion   # audita si el corpus realmente protege algo
```

Cubre la fase 5 de la hoja de ruta: *"consultas reales con respuesta esperada,
corridas en cada deploy, para que un error de categorización no rompa la
confianza en silencio."*

## Qué es un eval acá y en qué se diferencia de un test

Los tests de `lib/**/*.test.ts` protegen funciones contra regresiones
conocidas. Estos evals miden otra cosa: sobre un corpus de **casos reales** —el
correo textual del Banco GNB, la promoción de notebooks que una vez entró como
gasto, las frases con las que se escriben los comprobantes paraguayos—, ¿el
sistema sigue acertando cuando el mundo le manda lo que le manda de verdad?

Cada caso lleva tres cosas obligatorias: qué se espera, qué severidad tiene y
**por qué está en el corpus**. Si no se puede explicar por qué importa, el caso
sobra.

## Severidad

- **`critico`** — equivocarse mueve plata en la dirección equivocada o mete un
  importe falso en el disponible real.
- **`deseable`** — matices que preferimos acertar, pero cuyo error no le miente
  al usuario sobre cuánta plata tiene.

La severidad **no** decide si el deploy se corta: decide cómo se reporta y
cuánto urge. Lo único que deja pasar un caso en rojo es anotarlo a mano en
`LIMITACIONES_CONOCIDAS`, en `correr.ts`, con su explicación.

Esa lista reemplazó a un umbral porcentual ("que pase el 80% de los
deseables"). La auditoría por mutación mostró que el umbral no servía: al
borrar un arreglo, el caso correspondiente fallaba y la suite seguía en verde
porque 8 de 9 alcanzaban el umbral. **Un umbral con holgura tolera regresiones
por construcción.** La lista explícita obliga a que alguien escriba la excusa,
con su nombre, en el diff.

## La auditoría por mutación

`npm run evals:mutacion` rompe cada protección a propósito, una por vez, y
exige que la suite lo note.

Existe porque en este proyecto ya pasó lo contrario: el test *"RECHAZA
publicidad del banco"* seguía en verde con el filtro de publicidad **borrado**,
porque otros dos guardas atrapaban los mismos tres ejemplos. La lista entera de
palabras promocionales se podía eliminar sin que fallara nada.

Ya sirvió de nuevo acá: el filtro de porcentajes era código muerto para el
corpus —el rechazo de decimales en guaraníes atrapaba `5,5%` antes— hasta que
se agregó el caso `50%`, que no tiene decimales que lo delaten.

**Al agregar un caso o una protección nueva, correr esta auditoría.** Un corpus
que pasa no demuestra que el corpus sirva.

## Qué encontró la primera corrida

Tres fallas reales en código que ya estaba en producción:

1. **Un cobro se descontaba en vez de sumarse.** En *"Pago recibido del cliente
   Juan"*, `pago` (sale) y `recibido` (entra) empataban, y el empate caía al
   default `gasto`. Sobre ₲2.000.000 el error no es de ₲2.000.000 sino de
   ₲4.000.000, porque se resta lo que había que sumar.
2. **El saldo del aviso se guardaba como si fuera el movimiento.** *"Su saldo
   disponible es PYG 4.200.000 luego de la acreditación de PYG 500.000"*
   registraba un ingreso de 4,2 millones, con confianza suficiente para
   guardarse solo. Solo fallaba cuando el banco nombraba el saldo primero: la
   protección anterior —tomar el primer importe— era casualidad, no diseño.
3. **La confianza dependía del plural.** *"Compras"* hacía match con `compra` y
   con `compras` a la vez y puntuaba 2; *"compra"*, 1. Dos es el puntaje con el
   que la UI deja de pedir revisión. La fuerza de una prueba no puede depender
   de la gramática.

## Cuándo corre

En cada push a `main` y en cada PR, vía `.github/workflows/evals.yml`. Como
Vercel despliega desde git, eso es "en cada deploy" sin atar el build del sitio
a la versión de Node del proveedor.
