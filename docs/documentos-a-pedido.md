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

## Cómo quedó conectado en n8n

**Ya está hecho.** El workflow `EOS 4.0 - Conversational Gateway WORKER GATE RC1`
(id `JRgzUkoHBKgGpyPA`) quedó actualizado el 2026-08-26, y su JSON está
versionado en
[`n8n/workflows/eos-conversational-gateway-rc1.json`](../n8n/workflows/eos-conversational-gateway-rc1.json),
sin credenciales.

### Por qué NO se usó el bloque cercado

Ese workflow le exige al modelo un JSON estricto y le prohíbe el markdown y los
bloques de código. Meterle un bloque cercado sería pedirle justo lo que el resto
del prompt le prohíbe. Así que la integración usa **la otra forma que este
repositorio ya aceptaba**: un campo `documento` dentro del JSON de la respuesta.

El bloque cercado sigue funcionando y sigue documentado más arriba, para
cualquier otro canal que mande texto libre.

### Los dos cambios

1. **El prompt del sistema** suma la sección "ARCHIVOS QUE PIDE EL USUARIO", con
   la forma del campo, los seis tipos de bloque y cinco reglas.
2. **El nodo `05 GW Preparar Respuesta`** pasa el campo a la salida. Como el nodo
   08 esparce `...base`, llega a la respuesta por las dos ramas: la de
   conversación pura y la del worker.

Y una regla que evita el peor caso: **si el modelo manda `documento` y además una
acción `GENERAR_EXCEL` / `GENERAR_PDF` / `GENERAR_WORD`, esas acciones se
descartan**. Sin eso, el worker viejo armaría su plantilla genérica al mismo
tiempo que el documento real, y el usuario recibiría dos archivos distintos por
un solo pedido.

### Lo que encontró la prueba de punta a punta

Pidiéndole un balance por el webhook real, el modelo marcó `"total": true` en la
columna de una tabla **resumen** —ingresos, gastos, resultado— y el renderizador
sumó las tres filas: `Gs. 24.800.000`. Un número que no significa nada y que el
lector lee como un error del sistema.

Por eso el prompt tiene una quinta regla: totalizar solo cuando las filas se
suman de verdad, como el detalle de una factura. Verificado después del cambio:
la tabla resumen dejó de totalizar y la de detalle siguió haciéndolo.

### Cómo probarlo sin gastarle un mensaje a nadie

La puerta de admisión del gateway exige una reserva de cupo creada por la app,
así que un POST suelto al webhook se rechaza. El camino es reservar con
`eos_reserve_message_quota_server_v75`, llamar al webhook y **liberar** con
`eos_release_message_quota_server_v75` — que es exactamente lo que hace
`/api/eos` cuando n8n falla. La prueba no consume cupo.
