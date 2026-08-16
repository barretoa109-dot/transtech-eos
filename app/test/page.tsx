"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TestPage() {
  const [usuarios, setUsuarios] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let active = true;

    void supabase
      .from("usuarios")
      .select("*")
      .then(({ data }) => {
        if (active) setUsuarios(data || []);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Prueba Supabase</h1>

      <pre>
        {JSON.stringify(usuarios, null, 2)}
      </pre>
    </div>
  );
}
