# Certificación del recorrido comercial

```bash
npm run certificar
```

Es la lista que hay que ver en verde **antes de abrirle EOS a alguien que pagó**.
Recorre lo que hace un cliente de verdad —registrarse, elegir módulos, pagar,
usar el ERP, equivocarse y corregir, irse— contra la base y la pasarela reales.

Para correr un caso suelto:

```bash
npm run certificar -- 3 6
```

## Los tres colores

| | |
| --- | --- |
| `ok` | Se probó y salió bien. |
| `FALLA` | Se probó y salió mal. Si el caso es crítico, no se lanza. |
| `··` | **No se pudo probar en esta corrida**, con el motivo al lado. |

El tercero existe porque Bancard bloquea el mismo importe sobre la misma tarjeta
durante cinco minutos. Correr la suite dos veces seguidas la pondría roja por
algo que no está roto, y una suite que se pone roja sin motivo enseña a ignorar
el rojo. Tampoco se puede dar por bueno: quedaría sin probar el pago sin que
nadie se entere. Por eso se cuenta aparte y se muestra al final.

**Si ves amarillo, esperá cinco minutos y volvé a correr ese caso.**

## Por qué toca datos de verdad

A diferencia de `npm test` y `npm run evals`, que son cálculo puro, acá se
crean ventas, se cobran tarjetas y se activan módulos. Es la única forma de
certificar un circuito comercial: un pago simulado prueba que la simulación
funciona.

Los candados que lo hacen seguro:

1. **Bancard tiene que estar en `staging`.** Con las claves de producción, la
   suite le cobraría a tarjetas reales. Si `BANCARD_ENV` no dice `staging`, no
   corre.
2. **Todo pasa por una sola cuenta de certificación**, nunca por la de un
   usuario. Se configura con `EOS_CERT_EMAIL`; por defecto
   `demo@transtech.com.py`.
3. **Cada caso limpia lo que creó**, y el corredor limpia igual si un caso
   explota a la mitad. Los casos que tocan el plan o los módulos de la cuenta los
   guardan antes y los reponen después.

La cuenta de certificación necesita **una tarjeta de prueba ya catastrada**.
Catastrar exige el formulario de Bancard en un navegador y no se puede
automatizar; se hace una vez a mano.

## Lo que esto NO prueba

Una suite en verde no significa que EOS esté bien. Significa que las piezas
encajan. Lo siguiente hay que mirarlo con los ojos, y conviene hacerlo entero
antes de cada lanzamiento:

### Pantallas

- [ ] **Registro** con correo y con Google, hasta entrar. El login con Google no
      se puede automatizar porque exige escribir una contraseña en el formulario
      de Google.
- [ ] **Armador de planes**: prender y apagar módulos, que el total se mueva, y
      que con todo prendido diga Gs. 500.000 exactos.
- [ ] **Pago con 3DS**: si el emisor lo pide, el desafío se abre en un iframe y
      al terminar tiene que volver a la ventana grande, no quedar apretado
      adentro de la cajita.
- [ ] **Pago por transferencia**, que no pasa por Bancard.
- [ ] **Onboarding completo**, leyendo lo que dice. Que los pasos sean
      recorribles lo prueba la suite; que las preguntas tengan sentido y el tono
      acompañe, no.
- [ ] **Panel multimoneda**: un movimiento en guaraníes y otro en dólares tienen
      que verse en bloques separados, nunca sumados.
- [ ] **Vender por chat**: pedirle una venta, que diga que la deja lista para
      confirmar —nunca que ya la cargó—, aprobarla en `/eos/autonomy` y ver que
      aparezca.
- [ ] **Descarga de archivos**: pedir el mismo informe en Excel, PDF y Word, y
      abrir los tres.
- [ ] **Cerrar sesión** desde el perfil, y que el botón "atrás" no deje una
      pantalla vacía.
- [ ] **En teléfono**, no sólo en computadora. La mayoría de los usuarios de EOS
      van a entrar desde el celular.

### Lo que no depende de nosotros

- [ ] **Factura electrónica**: hoy arma el documento y calcula el CDC, pero no
      firma ni envía a SIFEN. Eso depende del certificado digital de cada
      usuario y de su habilitación ante la SET. Mientras siga así, no se vende
      como "facturación electrónica completa". Ver
      `docs/facturacion-quien-emite-que.md`.

## Agregar un caso

Un archivo en `casos/`, con esta forma:

```js
export const caso = {
  numero: 11,
  nombre: "Lo que se prueba, dicho como se lo contarías a alguien",
  critico: true,

  async correr({ admin, usuario, comprobar, sinProbar, alTerminar }) {
    alTerminar(() => /* borrar lo que creaste */);
    comprobar("una afirmación que se lee sola", condicion, "detalle si falla");
  },
};
```

Y agregarlo a `CASOS` en `correr.mjs`.

Dos costumbres que valen la pena:

**El título dice qué se espera, no qué se hace.** "una venta a crédito NO suma
plata que todavía no está" explica el porqué; "test venta credito" no explica
nada cuando falla a las once de la noche.

**Todo lo que falla dice por qué.** Una comprobación en rojo sin detalle obliga
a rehacer a mano lo que la suite acaba de hacer.
