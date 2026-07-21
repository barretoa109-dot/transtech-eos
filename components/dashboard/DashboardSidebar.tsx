"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface DashboardSidebarProps {
  onNavigate?: () =>void;
}

const menu = [
  {
    title: "Inicio",
    href: "/dashboard",
    icon: "🏠",
  },
  {
    title: "EOS",
    href: "/dashboard/eos",
    icon: "🤖",
  },
  {
    title: "Historial",
    href: "/dashboard/historial",
    icon: "🕘",
  },
  {
    title: "Archivos",
    href: "/dashboard/archivos",
    icon: "📁",
  },
  {
    title: "Configuración",
    href: "/dashboard/configuracion",
    icon: "⚙️",
  },
];

export default function DashboardSidebar({
    onNavigate,
}: DashboardSidebarProps) {

    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();

    const [nombre, setNombre] = useState("Usuario");
    const [email, setEmail] = useState("");
    const [plan, setPlan] = useState("Free");
    const [loading, setLoading] = useState(true);

    useEffect(() => {

        async function cargarUsuario() {

            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) return;

            const { data } = await supabase
                .from("usuarios")
                .select("nombre,email,plan")
                .eq("id", user.id)
                .single();

            if (data) {
                setNombre(data.nombre ?? "Usuario");
                setEmail(data.email ?? user.email ?? "");
                setPlan(data.plan ?? "Free");
            }

            setLoading(false);
        }

        cargarUsuario();

    }, []);

    async function cerrarSesion() {

        await supabase.auth.signOut();

        router.replace("/login");
        router.refresh();

    }

    return (

        <aside className="flex h-screen w-72 flex-col border-r border-slate-800 bg-slate-950">

            {/* LOGO */}

            <div className="border-b border-slate-800 px-6 py-6">

                <div className="flex items-center gap-4">

                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-xl font-black text-white">
                        T
                    </div>

                    <div>

                        <h2 className="text-lg font-black text-white">
                            TransTech
                        </h2>

                        <p className="text-xs text-slate-500">
                            Enterprise OS
                        </p>

                    </div>

                </div>

            </div>

            {/* MENU */}

            <nav className="flex-1 px-4 py-6">

                <div className="space-y-2">

                    {menu.map((item) => {

                        const activo =
                            pathname === item.href ||
                            (item.href !== "/dashboard" &&
                                pathname.startsWith(item.href));

                        return (

                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={onNavigate}
                                className={`flex items-center gap-4 rounded-xl px-4 py-3 transition ${
                                    activo
                                        ? "bg-blue-600 text-white shadow-lg"
                                        : "text-slate-400 hover:bg-slate-900 hover:text-white"
                                }`}
                            >

                                <span className="text-xl">
                                    {item.icon}
                                </span>

                                <span className="font-semibold">
                                    {item.title}
                                </span>

                            </Link>

                        );

                    })}

                </div>

            </nav>

            {/* USUARIO */}

            <div className="border-t border-slate-800 p-5">

                {loading ? (

                    <div className="animate-pulse">

                        <div className="h-5 w-36 rounded bg-slate-800"></div>

                        <div className="mt-2 h-4 w-48 rounded bg-slate-800"></div>

                    </div>

                ) : (

                    <>

                        <div className="flex items-center gap-4">

                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">

                                {nombre.charAt(0).toUpperCase()}

                            </div>

                            <div className="min-w-0 flex-1">

                                <p className="truncate font-bold text-white">
                                    {nombre}
                                </p>

                                <p className="truncate text-xs text-slate-500">
                                    {email}
                                </p>

                            </div>

                        </div>

                        <div className="mt-5 flex items-center justify-between rounded-xl bg-slate-900 p-4">

                            <div>

                                <p className="text-xs text-slate-500">
                                    Plan actual
                                </p>

                                <p className="font-bold text-white">
                                    {plan}
                                </p>

                            </div>

                            <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                                ACTIVO
                            </span>

                        </div>

                        <button
                            type="button"
                            onClick={cerrarSesion}
                            className="mt-5 w-full rounded-xl border border-red-500/20 px-4 py-3 font-semibold text-red-300 transition hover:bg-red-500/10"
                        >
                            Cerrar sesión
                        </button>

                    </>

                )}

            </div>

        </aside>

    );

}