#!/usr/bin/env node
/**
 * Regenera lib/agentes/versiones.generado.ts a partir de agentes/.
 *
 *   npm run agentes:versiones
 *
 * Correrlo después de tocar cualquier regla, prompt o plantilla. El test de
 * lib/agentes/versiones.test.ts falla si no se corrió.
 */

import fs from "node:fs";

const { calcularTodas, textoDelGenerado } = await import("../lib/agentes/versiones.ts");

const destino = new URL("../lib/agentes/versiones.generado.ts", import.meta.url);
const versiones = calcularTodas();
fs.writeFileSync(destino, textoDelGenerado(versiones));

for (const [agente, version] of Object.entries(versiones)) console.log(`${agente.padEnd(11)} ${version}`);
