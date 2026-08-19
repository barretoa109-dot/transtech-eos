"use client";

import { useEffect, useRef } from "react";
import type * as THREE from "three";

/**
 * Decorative rotating-icosahedron + particle field, ported from the redesign
 * mockups' inline <script> to a proper npm `three` import (no runtime CDN
 * dependency). Fails silently (hides the canvas) if WebGL/three isn't available,
 * same behavior as the original mockups.
 */
export default function TechCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let frameId = 0;
    let resizeHandler: (() => void) | null = null;

    import("three")
      .then((THREE) => {
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, 7);

        const geo = new THREE.IcosahedronGeometry(1.9, 1);
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x2f72d6, transparent: true, opacity: 0.32 })
        );
        line.position.set(3.4, -0.6, -1);
        scene.add(line);

        const count = 100;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 13;
          positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 5 - 1;
        }
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const points = new THREE.Points(
          pGeo,
          new THREE.PointsMaterial({ color: 0xa9c6ee, size: 0.045, transparent: true, opacity: 0.55 })
        );
        scene.add(points);

        resizeHandler = () => {
          if (!renderer) return;
          renderer.setSize(window.innerWidth, window.innerHeight);
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", resizeHandler);

        let t = 0;
        const animate = () => {
          if (disposed || !renderer) return;
          frameId = requestAnimationFrame(animate);
          t += 0.003;
          line.rotation.y = t;
          line.rotation.x = t * 0.4;
          points.rotation.y = t * 0.08;
          renderer.render(scene, camera);
        };
        animate();
        requestAnimationFrame(() => canvas.classList.add("ready"));
      })
      .catch((err) => {
        console.warn("Fondo 3D no disponible:", err instanceof Error ? err.message : err);
        canvas.style.display = "none";
      });

    return () => {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      renderer?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className={`eos-tech-canvas ${className ?? ""}`} aria-hidden="true" />;
}
