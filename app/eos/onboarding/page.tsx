"use client";

import { useRouter } from "next/navigation";

import "../chat/eosApp.css";

import OnboardingConversacion from "../components/OnboardingConversacion";

/**
 * La conversación fundacional vive en su propia pantalla, no en una tarjeta del
 * panel.
 *
 * Es deliberado: si conviviera con el dashboard, el usuario tendría a la vista
 * los números de los que todavía no sabe nada y las preguntas competirían con
 * el resto de la interfaz. La hoja de ruta la llama "una sola conversación", y
 * una conversación necesita la pantalla entera.
 */
export default function OnboardingPage() {
  const router = useRouter();

  return (
    <div className="eos-app" data-eos-theme="light">
      <main className="onb-pantalla">
        <div className="onb-marca">
          <img src="/transtech-logo.png" alt="TransTech" width={28} height={28} />
          <span>EOS</span>
        </div>

        <OnboardingConversacion onListo={() => router.push("/eos/chat")} />
      </main>
    </div>
  );
}
