import { createClient } from "@supabase/supabase-js";

let adminClient:
  | ReturnType<typeof createClient>
  | undefined;

export function createAdminClient() {
  if (adminClient) {
    return adminClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado.");
  }

  if (!serviceRole) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurado.");
  }

  adminClient = createClient(url, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}