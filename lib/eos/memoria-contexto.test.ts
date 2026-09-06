import test from "node:test";
import assert from "node:assert/strict";

import { textoMemoria, TOPES } from "./memoria-contexto.ts";

function memoria(p: Partial<Parameters<typeof textoMemoria>[0]["memorias"] extends (infer T)[] | null | undefined ? T : never> = {}) {
  return {
    titulo: "Dato",
    contenido: "Le dicen Guto y prefiere que le hablen de vos.",
    importancia: 5,
    estado: "activo",
    ...p,
  };
}

function objetivo(p: Record<string, unknown> = {}) {
  return { titulo: "Abrir el segundo local", progreso: 0, estado: "activo", ...p };
}

function aprendizaje(p: Record<string, unknown> = {}) {
  return {
    recomendacion: "Arrancar con una pregunta de diagnóstico antes de suponer datos.",
    confianza: 0.9,
    evidence_count: 10,
    estado: "activo",
    ...p,
  };
}

test("sin nada guardado no se escribe ningún encabezado", () => {
  // Un "Lo que ya sabés de esta persona:" seguido de nada le dice al modelo
  // que no sabe nada de nadie.
  assert.equal(textoMemoria({}), "");
  assert.equal(textoMemoria({ memorias: [], objetivos: [], aprendizajes: [] }), "");
  assert.equal(textoMemoria({ memorias: null, objetivos: null, aprendizajes: null }), "");
});

test("una memoria aparece con su contenido", () => {
  const texto = textoMemoria({ memorias: [memoria()] });
  assert.match(texto, /Le dicen Guto/);
});

test("la misma memoria repetida entra una sola vez", () => {
  // El caso real de producción: la misma frase guardada tres veces con
  // segundos de diferencia. Repetida, el modelo la trata como tres datos.
  const texto = textoMemoria({
    memorias: [memoria(), memoria(), memoria()],
  });

  assert.equal(texto.split("Le dicen Guto").length - 1, 1);
});

test("dos memorias que solo difieren en puntuación siguen siendo una", () => {
  const texto = textoMemoria({
    memorias: [
      memoria({ contenido: "Vende ropa importada." }),
      memoria({ contenido: "vende ropa importada" }),
    ],
  });

  assert.equal(texto.split(/vende ropa importada/i).length - 1, 1);
});

test("las memorias más importantes van primero", () => {
  const texto = textoMemoria({
    memorias: [
      memoria({ contenido: "Detalle menor", importancia: 1 }),
      memoria({ contenido: "Lo que más pesa", importancia: 9 }),
    ],
  });

  assert.ok(texto.indexOf("Lo que más pesa") < texto.indexOf("Detalle menor"));
});

test("no entran más memorias que el tope", () => {
  const muchas = Array.from({ length: 30 }, (_, i) => memoria({ contenido: `dato numero ${i}` }));
  const texto = textoMemoria({ memorias: muchas });

  const renglones = texto.split("\n").filter((l) => l.startsWith("  - "));
  assert.equal(renglones.length, TOPES.memorias);
});

test("lo archivado no se le cuenta al modelo", () => {
  const texto = textoMemoria({
    memorias: [memoria({ contenido: "Ya no vale", estado: "archivado" })],
  });

  assert.equal(texto, "");
});

test("una memoria vacía no genera un renglón en blanco", () => {
  const texto = textoMemoria({
    memorias: [memoria({ contenido: "   ", titulo: "  " })],
  });

  assert.equal(texto, "");
});

test("cae al título cuando el contenido está vacío", () => {
  const texto = textoMemoria({
    memorias: [memoria({ contenido: "", titulo: "Trabaja con su hermana" })],
  });

  assert.match(texto, /Trabaja con su hermana/);
});

test("una memoria larguísima se recorta y se nota que se recortó", () => {
  const larga = "palabra ".repeat(200);
  const texto = textoMemoria({ memorias: [memoria({ contenido: larga })] });
  const renglon = texto.split("\n").find((l) => l.startsWith("  - "))!;

  assert.ok(renglon.length <= TOPES.linea + 6, `quedó de ${renglon.length}`);
  assert.match(renglon, /…$/);
});

test("el objetivo en cero no arrastra un '0%' que nadie completó", () => {
  const texto = textoMemoria({ objetivos: [objetivo({ progreso: 0 })] });

  assert.match(texto, /Abrir el segundo local/);
  assert.doesNotMatch(texto, /0%/);
});

test("el progreso aparece cuando alguien lo movió", () => {
  const texto = textoMemoria({ objetivos: [objetivo({ progreso: 40 })] });
  assert.match(texto, /40%/);
});

test("el objetivo lleva su fecha y su próximo paso cuando los tiene", () => {
  const texto = textoMemoria({
    objetivos: [objetivo({ fecha_limite: "2026-12-31", proximo_paso: "Firmar el alquiler" })],
  });

  assert.match(texto, /2026-12-31/);
  assert.match(texto, /Firmar el alquiler/);
});

test("un aprendizaje sin evidencia suficiente no le cambia el comportamiento al modelo", () => {
  // Es la protección que más importa de este archivo: una corazonada del
  // sistema sobre sí mismo, metida en el prompt, cambia cómo responde sin que
  // nadie lo haya decidido y sin que aparezca en ninguna pantalla.
  assert.equal(textoMemoria({ aprendizajes: [aprendizaje({ evidence_count: 1 })] }), "");
  assert.equal(textoMemoria({ aprendizajes: [aprendizaje({ confianza: 0.3 })] }), "");
  assert.notEqual(textoMemoria({ aprendizajes: [aprendizaje()] }), "");
});

test("el aprendizaje se presenta como observación, no como orden", () => {
  const texto = textoMemoria({ aprendizajes: [aprendizaje()] });
  assert.match(texto, /funcionó antes/);
});

test("las tres secciones conviven y cada una tiene su encabezado", () => {
  const texto = textoMemoria({
    memorias: [memoria()],
    objetivos: [objetivo()],
    aprendizajes: [aprendizaje()],
  });

  assert.match(texto, /Lo que te contó y quedó guardado:/);
  assert.match(texto, /Lo que se propuso:/);
  assert.match(texto, /Lo que con esta persona funcionó antes:/);
});

test("el bloque entero se mantiene chico", () => {
  // El prompt de hoy son ~1.300 tokens medidos en producción. Este bloque no
  // puede ser el que lo duplique: si crece sin control, cada mensaje de cada
  // usuario cuesta más y el modelo tiene más donde perderse.
  const texto = textoMemoria({
    memorias: Array.from({ length: 30 }, (_, i) => memoria({ contenido: `dato numero ${i} `.repeat(60) })),
    objetivos: Array.from({ length: 30 }, (_, i) => objetivo({ titulo: `objetivo ${i} `.repeat(60) })),
    aprendizajes: Array.from({ length: 30 }, (_, i) => aprendizaje({ recomendacion: `regla ${i} `.repeat(60) })),
  });

  assert.ok(texto.length < 3000, `el bloque quedó en ${texto.length} caracteres`);
});
