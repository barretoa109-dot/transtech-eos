import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre,plan")
    .eq("id", user.id)
    .maybeSingle();

  const nombre =
    usuario?.nombre ??
    user.user_metadata?.nombre ??
    user.email?.split("@")[0] ??
    "Usuario";

  const plan = usuario?.plan ?? "Free";

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <div className="hidden lg:block">
        <DashboardSidebar />
      </div>

      <div className="min-w-0 flex-1">
        <DashboardHeader nombre={nombre} plan={plan} />

        <main className="min-h-[calc(100vh-5rem)] overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}