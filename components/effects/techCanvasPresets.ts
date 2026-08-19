import type { TechCanvasConfig } from "./TechCanvas";

/** login.html — single icosahedron, offset right, no mouse parallax. */
export const loginTechCanvas: TechCanvasConfig = {
  standalonePosition: [3.4, -0.6, -1],
  icosahedrons: [{ radius: 1.9, detail: 1, color: 0x2f72d6, opacity: 0.32, rotYMul: 1, rotXMul: 0.4 }],
  particles: { count: 100, color: 0xa9c6ee, size: 0.045, opacity: 0.55, spread: [6.5, 4, 2.5, -1], rotYMul: 0.08 },
  timeStep: 0.003,
};

/** home.html — dual icosahedron group + mouse parallax. */
export const homeTechCanvas: TechCanvasConfig = {
  groupPosition: [0, 0.6, 0],
  icosahedrons: [
    { radius: 2.1, detail: 1, color: 0x2f72d6, opacity: 0.4, rotYMul: 1, rotXMul: 0.5 },
    { radius: 1.3, detail: 0, color: 0x6fa3e8, opacity: 0.3, rotYMul: -1.2, rotXMul: 0.35 },
  ],
  particles: { count: 140, color: 0xa9c6ee, size: 0.045, opacity: 0.6, spread: [6.5, 4, 2.5, -1], rotYMul: 0.1 },
  timeStep: 0.003,
  mouseParallax: true,
  lookAt: [0, 0.6, 0],
};

/** eos.html — single (larger) icosahedron group, offset right, no mouse parallax. */
export const eosTechCanvas: TechCanvasConfig = {
  groupPosition: [2.4, 0.4, 0],
  icosahedrons: [{ radius: 2.0, detail: 1, color: 0x2f72d6, opacity: 0.35, rotYMul: 1, rotXMul: 0.4 }],
  particles: { count: 110, color: 0xa9c6ee, size: 0.045, opacity: 0.55, spread: [6.5, 4, 2.5, -1], rotYMul: 0.1 },
  timeStep: 0.003,
};

/** planes.html — single small icosahedron, top-left, no particles. */
export const planesTechCanvas: TechCanvasConfig = {
  standalonePosition: [-3.2, 1.6, -1],
  icosahedrons: [{ radius: 1.6, detail: 0, color: 0x6fa3e8, opacity: 0.18, rotYMul: 1, rotXMul: 0.4 }],
  timeStep: 0.002,
};

/** app.html — dual icosahedron group + mouse parallax, tighter particle field. */
export const appTechCanvas: TechCanvasConfig = {
  groupPosition: [1.3, 0.4, 0],
  icosahedrons: [
    { radius: 1.7, detail: 1, color: 0x1656bd, opacity: 0.28, rotYMul: 1, rotXMul: 0.6 },
    { radius: 1.05, detail: 0, color: 0x6fa3e8, opacity: 0.22, rotYMul: -1.3, rotXMul: 0.4 },
  ],
  particles: { count: 90, color: 0xa9c6ee, size: 0.045, opacity: 0.55, spread: [4.5, 3, 2, -1], rotYMul: 0.15 },
  timeStep: 0.0035,
  mouseParallax: true,
  lookAt: [1.0, 0.3, 0],
};
