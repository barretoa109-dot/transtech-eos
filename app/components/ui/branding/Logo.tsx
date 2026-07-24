"use client";

import Image from "next/image";

type LogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

export default function Logo({
  size = 44,
  className,
  priority = false,
}: LogoProps) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <Image
        src="/transtech-logo.png"
        alt="Logo de TRANSTECH"
        fill
        priority={priority}
        sizes={`${size}px`}
        style={{
          objectFit: "contain",
        }}
      />
    </div>
  );
}