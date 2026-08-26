# Documentos a pedido

Cómo hace EOS para mandar un Excel, un PDF o un Word **con lo que el usuario
pidió**, y no una plantilla genérica.

## La idea

EOS no genera archivos. EOS **describe** el documento; el repositorio lo dibuja.

La lista de cosas que alguien puede pedir es infinita —un cuadro de necesidades,
un presupuesto, un acta, una lista de precios—, pero la lista de formas de
mostrar algo en una hoja es corta: título, párrafo, lista, tabla, indicador,
advertencia. Con esos seis bloques se arma cualquiera de las anteriores.

Eso vive en [`lib/documentos/especificacion.ts`](../lib/documentos/especificacion.ts).
Los tres renderizadores (`excel.ts`, `pdf.ts`, `word.ts`) leen la misma
descripción, así que **los tres formatos dicen exactamente lo mismo**.

## El camino completo

1. El usuario pide algo ("armame en Excel las necesidades que fuimos anotando").
2. EOS contesta normal **y** agrega un bloque cercado con la descripción.
3. `app/api/eos/route.ts` lo saca del texto, lo normaliza y lo guarda en
   `eos_documentos_generados`. El bloque **no** queda en la burbuja del chat.
4. La respuesta vuelve con `archivo_url = /api/documentos/<id>?formato=excel`,
   que se guarda dentro del texto del mensaje para que sobreviva a la recarga.
5. `GET /api/documentos/<id>?formato=…` dibuja el archivo en el momento.

Como se guarda la descripción y no el binario, el mismo documento se baja en los
tres formatos sin volver a molestar a EOS —y sin gastar otro mensaje del plan.

## Lo que tiene que emitir EOS

Un bloque cercado con la etiqueta `eos:documento` y un JSON adentro:

    ```eos:documento
    {
      "titulo": "Necesidades del negocio",
      "subtitulo": "Relevadas en las conversaciones de agosto",
      "moneda": "PYG",
      "bloques": [
        { "tipo": "parrafo", "texto": "Esto es lo que fuiste mencionando." },
        {
          "tipo": "indicadores",
          "items": [{ "etiqueta": "Necesidades", "valor": "6", "detalle": "3 urgentes" }]
        },
        {
          "tipo": "tabla",
          "titulo": "Detalle",
          "columnas": [
            { "titulo": "Necesidad", "tipo": "texto" },
            { "titulo": "Urgencia", "tipo": "texto" },
            { "titulo": "Costo estimado", "tipo": "dinero", "total": true }
          ],
          "filas": [["Reponer envases", "Alta", 8500000]]
        },
        { "tipo": "nota", "texto": "Los costos son estimaciones tuyas, no presupuestos." }
      ]
    }
    ```

Alternativa sin tocar el texto: mandar el mismo objeto en un campo `documento`
(o dentro de `metadata.documento`) del JSON de la respuesta. Las dos formas se
aceptan a propósito, porque el workflow del chat vive en la instancia de n8n y
no en este repositorio: la del bloque cercado se activa cambiando **solo el
prompt**, sin tocar el workflow.

### Los tipos de bloque

| `tipo` | Campos | Para qué |
| --- | --- | --- |
| `titulo` | `texto`, `nivel` (1-3) | Separar secciones |
| `parrafo` | `texto` | Explicar |
| `lista` | `items`, `ordenada` | Enumerar |
| `tabla` | `titulo`, `columnas`, `filas` | Los datos |
| `indicadores` | `items` (`etiqueta`, `valor`, `detalle`) | Los números de arriba |
| `nota` | `texto` | Lo que EOS **no** puede garantizar |

Tipos de columna: `texto`, `numero`, `dinero`, `fecha`, `porcentaje`. Poner
`"total": true` en una columna numérica agrega la fila de totales al pie.

### Reglas que conviene respetar

- **Los importes van como número**, no como `"₲ 8.500.000"`. En Excel eso es la
  diferencia entre poder sumar una columna y tener que retipearla. (Si igual
  llega como texto, se intenta convertirlo: se entienden tanto `1.250.000` como
  `1,250,000.50`.)
- **Las filas son arreglos** en el orden de las columnas. Una fila más corta se
  completa con vacíos; **nunca se corre** una celda de columna.
- **Lo que EOS no sabe, va en una `nota`.** Un documento que se presenta como
  completo cuando no lo es hace más daño que no existir.

## Los topes

Los pone `normalizarDocumento`, que es la única puerta de entrada. Lo que se
pasa se **recorta** (y el recorte queda registrado); lo que no se entiende se
**descarta**. Nada llega crudo a exceljs ni a pdfkit.

| Qué | Tope |
| --- | --- |
| Secciones por documento | 120 |
| Columnas por tabla | 24 |
| Filas por tabla | 2.000 |
| Celdas en todo el documento | 20.000 |
| Ítems por lista | 300 |

## Detalles que ya costaron un bug

- **El PDF escribe "Gs." y no "₲".** Las fuentes base del PDF usan WinAnsi, que
  no tiene el signo del guaraní: pdfkit no falla, dibuja `²`. Todo texto pasa
  por `paraPdf()` antes de dibujarse. En Excel y Word sí va `₲`.
- **El pie de página anulaba el margen inferior.** Escribir abajo del margen
  hacía que pdfkit agregara una página por página: el documento salía con el
  doble de carillas.
- **Una tabla, una hoja de Excel.** Apilar tablas en la misma hoja hace que el
  filtro automático agarre las filas equivocadas.

## El texto para pegar en el prompt de n8n

Esto es lo único que falta para que EOS empiece a mandar archivos: el workflow
del chat vive en la instancia de n8n, no en este repositorio, así que hay que
agregarle estas instrucciones al prompt del agente. No hace falta tocar el
workflow: el bloque cercado viaja dentro de la respuesta de texto.

---

> **Cuando el usuario te pida un archivo** —una planilla, un informe, un cuadro,
> un balance, una lista para imprimir— además de tu respuesta normal agregá al
> final un bloque cercado con la etiqueta `eos:documento` y un JSON adentro.
>
> No expliques el bloque ni lo menciones: el sistema lo saca del texto antes de
> mostrarlo y lo convierte en un archivo descargable en Excel, PDF y Word.
>
> El JSON tiene esta forma:
>
> ```
> {
>   "titulo": "...",
>   "subtitulo": "...",
>   "moneda": "PYG",
>   "bloques": [ ... ]
> }
> ```
>
> Cada bloque es uno de estos:
>
> - `{"tipo": "titulo", "texto": "...", "nivel": 1}`
> - `{"tipo": "parrafo", "texto": "..."}`
> - `{"tipo": "lista", "ordenada": false, "items": ["...", "..."]}`
> - `{"tipo": "indicadores", "items": [{"etiqueta": "...", "valor": "...", "detalle": "..."}]}`
> - `{"tipo": "tabla", "titulo": "...", "columnas": [{"titulo": "...", "tipo": "texto|numero|dinero|fecha|porcentaje", "total": true}], "filas": [[...], [...]]}`
> - `{"tipo": "nota", "texto": "..."}` — para lo que NO podés garantizar.
>
> Cuatro reglas:
>
> 1. **Los importes van como número**, no como `"₲ 8.500.000"`. En Excel esa es
>    la diferencia entre poder sumar una columna y tener que retipearla.
> 2. **Las filas son arreglos** en el orden de las columnas. Si a una fila le
>    falta un dato, poné `null` en su lugar: nunca la acortes.
> 3. **Usá `nota` para lo que no sabés.** Si el usuario te pide un balance y no
>    ves sus pagos en efectivo, decilo adentro del documento.
> 4. **No inventes datos para llenar el archivo.** Un cuadro con tres filas
>    reales sirve; uno con doce inventadas hace tomar decisiones equivocadas.

---

Un ejemplo completo de respuesta:

    Armé el cuadro con las seis necesidades que fuiste mencionando. Las tres
    urgentes suman ₲ 14.900.000.

    ```eos:documento
    {
      "titulo": "Necesidades del negocio",
      "moneda": "PYG",
      "bloques": [
        {
          "tipo": "tabla",
          "columnas": [
            { "titulo": "Necesidad", "tipo": "texto" },
            { "titulo": "Urgencia", "tipo": "texto" },
            { "titulo": "Costo estimado", "tipo": "dinero", "total": true }
          ],
          "filas": [["Reponer envases", "Alta", 8500000]]
        },
        { "tipo": "nota", "texto": "Los costos son estimaciones tuyas, no presupuestos pedidos." }
      ]
    }
    ```
