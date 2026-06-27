import { redirect } from "next/navigation";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const archivo = searchParams.get("archivo");

  if (!archivo) {
    return new Response("Archivo no especificado", {
        status: 400,
    });
  }

  const supabaseUrl =
    `https://dirugpkamzgvyshcnsxs.supabase.co/storage/v1/object/public/EOS/${encodeURIComponent(archivo)}`;

  redirect(supabaseUrl);
}
