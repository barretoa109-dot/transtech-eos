import assert from "node:assert/strict";
import { test } from "node:test";

import { borrarArchivosDeLaCuenta, type ClienteStorage } from "./borrar-archivos.ts";

const YO = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

/** Un Storage en memoria: bucket → rutas de archivo. */
function storageFalso(inicial: Record<string, string[]>, fallar: string[] = []) {
  const archivos = new Map(Object.entries(inicial).map(([b, r]) => [b, new Set(r)]));
  const cliente: ClienteStorage = {
    storage: {
      from(bucket) {
        const set = archivos.get(bucket) ?? new Set<string>();
        return {
          async list(carpeta, { limit, offset }) {
            if (fallar.includes(bucket)) return { data: null, error: { message: "Storage caído" } };
            const hijos = new Map<string, boolean>();
            for (const r of set) {
              if (!r.startsWith(`${carpeta}/`)) continue;
              const resto = r.slice(carpeta.length + 1);
              const [primero, ...mas] = resto.split("/");
              hijos.set(primero, hijos.get(primero) || mas.length > 0);
            }
            const data = [...hijos.entries()].map(([name, esCarpeta]) => ({ name, id: esCarpeta ? null : `id-${name}` }));
            return { data: data.slice(offset, offset + limit), error: null };
          },
          async remove(rutas) {
            for (const r of rutas) set.delete(r);
            return { data: null, error: null };
          },
        };
      },
    },
  };
  return { cliente, archivos };
}

test("borra las fotos y los documentos de la cuenta, en todas las subcarpetas", async () => {
  const { cliente, archivos } = storageFalso({
    "eos-chat-imagenes": [`${YO}/a.jpg`, `${YO}/b.jpg`, `${OTRO}/c.jpg`],
    "eos-documents": [`${YO}/2026-09-01/x.pdf`, `${YO}/2026-09-02/y.xlsx`, `${OTRO}/2026-09-01/z.pdf`],
    "comprobantes-pago": [`${YO}/sol-1/recibo.jpg`],
  });

  const r = await borrarArchivosDeLaCuenta(cliente, YO);

  assert.deepEqual(r, [
    { bucket: "eos-chat-imagenes", borrados: 2 },
    { bucket: "eos-documents", borrados: 2 },
  ]);
  assert.deepEqual([...archivos.get("eos-chat-imagenes")!], [`${OTRO}/c.jpg`], "tocó archivos de otra cuenta");
  assert.deepEqual([...archivos.get("eos-documents")!], [`${OTRO}/2026-09-01/z.pdf`]);
  assert.deepEqual([...archivos.get("comprobantes-pago")!], [`${YO}/sol-1/recibo.jpg`], "los comprobantes se conservan");
});

test("si un bucket falla, informa y sigue con el otro", async () => {
  const { cliente } = storageFalso({ "eos-documents": [`${YO}/d/x.pdf`] }, ["eos-chat-imagenes"]);
  const r = await borrarArchivosDeLaCuenta(cliente, YO);
  assert.equal(r[0].bucket, "eos-chat-imagenes");
  assert.match(r[0].error ?? "", /Storage caído/);
  assert.deepEqual(r[1], { bucket: "eos-documents", borrados: 1 });
});

test("una cuenta sin archivos no rompe nada", async () => {
  const { cliente } = storageFalso({});
  assert.deepEqual(await borrarArchivosDeLaCuenta(cliente, YO), [
    { bucket: "eos-chat-imagenes", borrados: 0 },
    { bucket: "eos-documents", borrados: 0 },
  ]);
});

test("un id que no es un uuid no se usa como carpeta", async () => {
  const { cliente } = storageFalso({});
  await assert.rejects(borrarArchivosDeLaCuenta(cliente, ""), /inválido/);
  await assert.rejects(borrarArchivosDeLaCuenta(cliente, "../otra"), /inválido/);
});
