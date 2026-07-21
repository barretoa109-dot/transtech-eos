"use client";

import Link from "next/link";
import { useState } from "react";
import DashboardSidebar from "./DashboardSidebar";

interface DashboardHeaderProps {
  nombre: string;
  plan?: string;
}

export default function DashboardHeader({
  nombre,
  plan = "Free",
}: DashboardHeaderProps) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [notificacionesAbiertas, setNotificacionesAbiertas] =
    useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuAbierto(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-xl text-white transition hover:border-slate-600 hover:bg-slate-900 lg:hidden"
            aria-label="Abrir menú"
          >
            ☰
          </button>

          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 sm:text-sm">
              Bienvenido nuevamente
            </p>

            <h1 className="truncate text-base font-bold text-white sm:text-lg">
              {nombre}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setNotificacionesAbiertas(
                  (estadoActual) => !estadoActual
                )
              }
              className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 text-lg text-slate-300 transition hover:border-slate-600 hover:bg-slate-900 hover:text-white"
              aria-label="Notificaciones"
            >
              🔔

              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-500" />
            </button>

            {notificacionesAbiertas && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setNotificacionesAbiertas(false)}
                  aria-label="Cerrar notificaciones"
                />

                <div className="absolute right-0 top-14 z-50 w-80 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
                  <div className="border-b border-slate-800 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-bold text-white">
                        Notificaciones
                      </h2>

                      <span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-400">
                        1 nueva
                      </span>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="rounded-xl bg-slate-900 p-4">
                      <div className="flex gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                          ✦
                        </div>

                        <div>
                          <p className="text-sm font-semibold text-white">
                            EOS está listo
                          </p>

                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            Tu espacio de trabajo está disponible para
                            comenzar.
                          </p>

                          <p className="mt-2 text-xs text-slate-600">
                            Ahora
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Link
                    href="/dashboard/notificaciones"
                    onClick={() => setNotificacionesAbiertas(false)}
                    className="block border-t border-slate-800 px-5 py-4 text-center text-sm font-semibold text-blue-400 transition hover:bg-slate-900"
                  >
                    Ver todas
                  </Link>
                </div>
              </>
            )}
          </div>

          <div className="hidden items-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 sm:flex">
            <div>
              <p className="text-xs text-slate-500">Plan actual</p>

              <p className="text-sm font-bold capitalize text-white">
                {plan}
              </p>
            </div>
          </div>

          <Link
            href="/eos/chat"
            className="flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-500 sm:px-5"
          >
            <span className="text-base">✦</span>

            <span className="hidden sm:inline">Abrir EOS</span>
          </Link>
        </div>
      </header>

      {menuAbierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuAbierto(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Cerrar menú"
          />

          <div className="relative z-10 h-full w-72 animate-[slideIn_.2s_ease-out]">
            <DashboardSidebar
              onNavigate={() => setMenuAbierto(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}