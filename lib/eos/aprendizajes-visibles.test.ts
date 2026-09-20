import assert from "node:assert/strict";
import { test } from "node:test";

import { esAprendizajeDelNegocio } from "./aprendizajes-visibles.ts";

test("los de la categoría ejecución son del sistema, aunque suenen bien", () => {
  assert.equal(
    esAprendizajeDelNegocio({ categoria: "ejecucion", patron: "Cobra los viernes", recomendacion: "Recordar cobros" }),
    false,
  );
  assert.equal(esAprendizajeDelNegocio({ categoria: " Ejecucion ", patron: "x", recomendacion: "y" }), false);
});

test("uno que nombra una acción o la plomería del sistema no es del negocio", () => {
  assert.equal(
    esAprendizajeDelNegocio({ categoria: "operativo", patron: "p", recomendacion: "Mantener CREAR_TAREA como ruta preferente" }),
    false,
  );
  assert.equal(
    esAprendizajeDelNegocio({ categoria: "operativo", patron: "El worker tarda 15 minutos", recomendacion: "Revisar" }),
    false,
  );
});

test("uno sobre cómo trabaja la persona sí se muestra", () => {
  assert.equal(
    esAprendizajeDelNegocio({
      categoria: "finanzas",
      patron: "Cobra a crédito a la mayoría de sus clientes",
      recomendacion: "Preguntar la fecha de cobro al registrar una venta a crédito",
    }),
    true,
  );
});

test("sin categoría ni textos no revienta y se muestra", () => {
  assert.equal(esAprendizajeDelNegocio({}), true);
});
