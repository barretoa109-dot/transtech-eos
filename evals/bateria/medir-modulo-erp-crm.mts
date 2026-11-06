/**
 * Fase 1 del diseño multiagente: medir antes de prender nada.
 *
 *     node --experimental-strip-types evals/bateria/medir-modulo-erp-crm.mts
 *
 * No llama a ningún modelo — cero costo. Corre `necesitaModuloErpCrm` contra
 * los `esperado` de `evals/bateria/frases.ts`, que ya tienen el verbo
 * correcto verificado por la batería real. Lo único que importa de este
 * reporte es la columna de FALSOS NEGATIVOS: un caso donde el verbo
 * esperado es de negocio/CRM pero el clasificador diría que no hace falta
 * el módulo. Un solo falso negativo ahí es motivo para no prender esto en
 * producción todavía, no para agregar más palabras clave a mano.
 */
import { FRASES } from "./frases.ts";
import { necesitaModuloErpCrm, NOMBRES_ERP_CRM_EXCLUSIVOS, PROMPT_NUCLEO } from "../../lib/gateway/prompt-modulos.ts";
import { PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";

function esperaVerboDeNegocioOCrm(esperado: string[][]): boolean {
  return esperado.some((combinacion) => combinacion.some((verbo) => NOMBRES_ERP_CRM_EXCLUSIVOS.has(verbo)));
}

let falsosNegativos = 0;
let verdaderosPositivos = 0;
let ahorraEnPersonal = 0;
let noAhorraEnPersonal = 0;
const detalleFalsos: string[] = [];

for (const frase of FRASES) {
  const necesitaDeVerdad = esperaVerboDeNegocioOCrm(frase.esperado);
  const clasificadorDice = necesitaModuloErpCrm(
    frase.mensaje,
    (frase.historial ?? []).map((t) => ({ texto: t.texto })),
  );

  if (necesitaDeVerdad && !clasificadorDice) {
    falsosNegativos += 1;
    detalleFalsos.push(`  [${frase.id}] "${frase.mensaje}" — esperaba ${JSON.stringify(frase.esperado)}`);
  } else if (necesitaDeVerdad && clasificadorDice) {
    verdaderosPositivos += 1;
  } else if (!necesitaDeVerdad && !clasificadorDice) {
    ahorraEnPersonal += 1;
  } else {
    noAhorraEnPersonal += 1;
  }
}

const total = FRASES.length;
const ahorroPorCaracter = (1 - PROMPT_NUCLEO.length / PROMPT_SISTEMA.length) * 100;

console.log(`Casos en la batería: ${total}`);
console.log(`  Esperaban negocio/CRM, el clasificador acertó (true):  ${verdaderosPositivos}`);
console.log(`  Esperaban negocio/CRM, el clasificador falló (false): ${falsosNegativos}  ← tiene que ser 0`);
console.log(`  No esperaban negocio/CRM, el clasificador ahorró:     ${ahorraEnPersonal}`);
console.log(`  No esperaban negocio/CRM, pero incluyó igual:         ${noAhorraEnPersonal}`);
console.log("");
console.log(`Núcleo vs prompt completo: ${ahorroPorCaracter.toFixed(1)}% menos caracteres cuando se excluye el módulo.`);
console.log(
  `De los ${total} casos, en ${ahorraEnPersonal} (${((ahorraEnPersonal / total) * 100).toFixed(1)}%) se hubiera mandado el núcleo solo.`,
);

if (falsosNegativos > 0) {
  console.log("\nFALSOS NEGATIVOS (no prender el clasificador hasta resolver esto):");
  console.log(detalleFalsos.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nCero falsos negativos sobre la batería existente.");
}
