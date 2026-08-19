"use client";

import { useEffect, useRef } from "react";
import type * as THREE from "three";

export type TechCanvasIco = {
  radius: number;
  detail: 0 | 1;
  color: number;
  opacity: number;
  rotYMul: number;
  rotXMul: number;
};

export type TechCanvasParticles = {
  count: number;
  color: number;
  size: number;
  opacity: number;
  /** [xHalfSpread, yHalfSpread, zHalfSpread, zOffset] */
  spread: [number, number, number, number];
  rotYMul: number;
};

export type TechCanvasConfig = {
  /** If set, icosahedrons render inside a THREE.Group at this position. */
  groupPosition?: [number, number, number];
  /** Used only when there's a single icosahedron with no group (its own position). */
  standalonePosition?: [number, number, number];
  icosahedrons: TechCanvasIco[];
  particles?: TechCanvasParticles;
  /** Radians added to the shared time accumulator each frame. */
  timeStep: number;
  mouseParallax?: boolean;
  lookAt?: [number, number, number];
};

/**
 * Decorative rotating-icosahedron + particle field, ported from the redesign
 * mockups' inline <script> to a proper npm `three` import (no runtime CDN
 * dependency). Fails silently (hides the canvas) if WebGL/three isn't available,
 * same behavior as the original mockups. Config shape mirrors the exact
 * per-page three.js setups found in the mockup files.
 */
export default function TechCanvas({ config, className }: { config: TechCanvasConfig; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let frameId = 0;
    let resizeHandler: (() => void) | null = null;
    let mouseHandler: ((e: MouseEvent) => void) | null = null;

    import("three")
      .then((THREE) => {
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, 7);

        const icoMeshes: THREE.LineSegments[] = [];
        const parent = config.groupPosition ? new THREE.Group() : scene;
        if (config.groupPosition) {
          (parent as THREE.Group).position.set(...config.groupPosition);
          scene.add(parent as THREE.Group);
        }

        config.icosahedrons.forEach((ico, i) => {
          const geo = new THREE.IcosahedronGeometry(ico.radius, ico.detail);
          const mesh = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({ color: ico.color, transparent: true, opacity: ico.opacity })
          );
          if (!config.groupPosition && config.standalonePosition && i === 0) {
            mesh.position.set(...config.standalonePosition);
          }
          parent.add(mesh);
          icoMeshes.push(mesh);
        });

        let points: THREE.Points | null = null;
        if (config.particles) {
          const { count, color, size, opacity, spread } = config.particles;
          const [xs, ys, zs, zOffset] = spread;
          const positions = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * xs * 2;
            positions[i * 3 + 1] = (Math.random() - 0.5) * ys * 2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * zs * 2 + zOffset;
          }
          const pGeo = new THREE.BufferGeometry();
          pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color, size, transparent: true, opacity }));
          scene.add(points);
        }

        let mouseX = 0;
        let mouseY = 0;
        if (config.mouseParallax) {
          mouseHandler = (e: MouseEvent) => {
            mouseX = e.clientX / window.innerWidth - 0.5;
            mouseY = e.clientY / window.innerHeight - 0.5;
          };
          window.addEventListener("mousemove", mouseHandler);
        }

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
          t += config.timeStep;

          icoMeshes.forEach((mesh, i) => {
            const spec = config.icosahedrons[i];
            mesh.rotation.y = t * spec.rotYMul;
            mesh.rotation.x = t * spec.rotXMul;
          });

          if (points && config.particles) {
            points.rotation.y = t * config.particles.rotYMul;
          }

          if (config.mouseParallax) {
            camera.position.x += (mouseX * 1.2 - camera.position.x) * 0.03;
            camera.position.y += (-mouseY * 0.9 - camera.position.y) * 0.03;
            const [lx, ly, lz] = config.lookAt ?? [0, 0, 0];
            camera.lookAt(lx, ly, lz);
          }

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
      if (mouseHandler) window.removeEventListener("mousemove", mouseHandler);
      renderer?.dispose();
    };
  }, [config]);

  return <canvas ref={canvasRef} className={`eos-tech-canvas ${className ?? ""}`} aria-hidden="true" />;
}
