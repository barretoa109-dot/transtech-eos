"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TestPage() {
  const [usuarios, setUsuarios] = useState<any[]>([]);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from("usuarios")
      .select("*");

    setUsuarios(data || []);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Prueba Supabase</h1>

      <pre>
        {JSON.stringify(usuarios, null, 2)}
      </pre>
    </div>
  );
}