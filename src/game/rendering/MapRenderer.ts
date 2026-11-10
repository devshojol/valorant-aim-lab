import type { MapData } from '../maps/MapData';
import { CELL, WALL_HEIGHT } from '../maps/GridMap';
import {
  Color3,
  CreatePlane,
  CreateSphere,
  Mesh,
  StandardMaterial,
  Texture,
  VertexData,
  type Scene,
  type ShadowGenerator,
} from './babylon';
import {
  crateTexture,
  floorTexture,
  letterTexture,
  metalTexture,
  skyTexture,
  stoneTexture,
  wallTexture,
} from './textures';

type UvMode = { kind: 'world'; tile: number; vHeight: number } | { kind: 'box'; tile: number; vTile: number };

class GeometryBatch {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  quad(p: number[][], n: [number, number, number], uv: number[][]) {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i][0], p[i][1], p[i][2]);
      this.normals.push(n[0], n[1], n[2]);
      this.uvs.push(uv[i][0], uv[i][1]);
    }
    // Babylon convention: (p1-p0)x(p2-p0) points opposite the face normal.
    const ax = p[1][0] - p[0][0];
    const ay = p[1][1] - p[0][1];
    const az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0];
    const by = p[2][1] - p[0][1];
    const bz = p[2][2] - p[0][2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const dot = cx * n[0] + cy * n[1] + cz * n[2];
    if (dot < 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  box(min: number[], max: number[], uv: UvMode, skipBottom = true, topBatch: GeometryBatch | null = null, topTile = 4) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const U = (a: number, b: number, along: number, v: number): number[] => {
      if (uv.kind === 'world') return [along / uv.tile, v / uv.vHeight];
      void a;
      void b;
      return [along / uv.tile, v / uv.vTile];
    };
    const sideV = (y: number) => (uv.kind === 'world' ? y : y - y0);
    const alongX = (x: number) => (uv.kind === 'world' ? x : x - x0);
    const alongZ = (z: number) => (uv.kind === 'world' ? z : z - z0);
    // +X face
    this.quad(
      [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [1, 0, 0],
      [U(0, 0, alongZ(z0), sideV(y0)), U(0, 0, alongZ(z1), sideV(y0)), U(0, 0, alongZ(z1), sideV(y1)), U(0, 0, alongZ(z0), sideV(y1))],
    );
    // -X face
    this.quad(
      [
        [x0, y0, z1],
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
      ],
      [-1, 0, 0],
      [U(0, 0, -alongZ(z1), sideV(y0)), U(0, 0, -alongZ(z0), sideV(y0)), U(0, 0, -alongZ(z0), sideV(y1)), U(0, 0, -alongZ(z1), sideV(y1))],
    );
    // +Z face
    this.quad(
      [
        [x1, y0, z1],
        [x0, y0, z1],
        [x0, y1, z1],
        [x1, y1, z1],
      ],
      [0, 0, 1],
      [U(0, 0, -alongX(x1), sideV(y0)), U(0, 0, -alongX(x0), sideV(y0)), U(0, 0, -alongX(x0), sideV(y1)), U(0, 0, -alongX(x1), sideV(y1))],
    );
    // -Z face
    this.quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, -1],
      [U(0, 0, alongX(x0), sideV(y0)), U(0, 0, alongX(x1), sideV(y0)), U(0, 0, alongX(x1), sideV(y1)), U(0, 0, alongX(x0), sideV(y1))],
    );
    // top
    if (topBatch) {
      topBatch.quad(
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 1, 0],
        [
          [x0 / topTile, z0 / topTile],
          [x1 / topTile, z0 / topTile],
          [x1 / topTile, z1 / topTile],
          [x0 / topTile, z1 / topTile],
        ],
      );
    }
    const tileTop = uv.tile;
    if (!topBatch) this.quad(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 1, 0],
      [
        [alongX(x0) / tileTop, alongZ(z0) / tileTop],
        [alongX(x1) / tileTop, alongZ(z0) / tileTop],
        [alongX(x1) / tileTop, alongZ(z1) / tileTop],
        [alongX(x0) / tileTop, alongZ(z1) / tileTop],
      ],
    );
    if (!skipBottom || y0 > 0.01) {
      this.quad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y0, z0],
          [x0, y0, z0],
        ],
        [0, -1, 0],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      );
    }
  }

  floor(minX: number, minZ: number, maxX: number, maxZ: number, tile: number) {
    this.quad(
      [
        [minX, 0, minZ],
        [maxX, 0, minZ],
        [maxX, 0, maxZ],
        [minX, 0, maxZ],
      ],
      [0, 1, 0],
      [
        [minX / tile, minZ / tile],
        [maxX / tile, minZ / tile],
        [maxX / tile, maxZ / tile],
        [minX / tile, maxZ / tile],
      ],
    );
  }

  build(name: string, scene: Scene): Mesh | null {
    if (this.indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

export interface MapRenderResult {
  meshes: Mesh[];
  dispose(): void;
}

export function renderMap(scene: Scene, data: MapData, shadow: ShadowGenerator | null): MapRenderResult {
  const { def } = data;
  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];
  const mat = (name: string, tex: Texture | null, color?: Color3, spec = 0.06) => {
    const m = new StandardMaterial(name, scene);
    if (tex) m.diffuseTexture = tex;
    if (color) m.diffuseColor = color;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = 32;
    materials.push(m);
    return m;
  };

  const batches = new Map<string, { batch: GeometryBatch; material: StandardMaterial; castShadow: boolean }>();
  const getBatch = (key: string, makeMat: () => StandardMaterial, castShadow = true) => {
    let b = batches.get(key);
    if (!b) {
      b = { batch: new GeometryBatch(), material: makeMat(), castShadow };
      batches.set(key, b);
    }
    return b.batch;
  };

  const zones = def.palette.zones;
  const zoneSeed = (z: string) => [...z].reduce((a, c) => a + c.charCodeAt(0), 0);

  for (const box of data.boxes) {
    const zone = zones[box.zone] ?? Object.values(zones)[0];
    const seed = zoneSeed(box.zone);
    switch (box.kind) {
      case 'wall':
      case 'raised':
      case 'lintel': {
        // Wall tops get stone capping; raised floors (Heaven, stairs) get the zone's floor paving.
        const top =
          box.kind === 'raised'
            ? getBatch(`floor-${box.zone}`, () => mat(`floor-${box.zone}`, floorTexture(scene, zone.floor, seed + 101)), false)
            : getBatch(`cap-${box.zone}`, () => mat(`cap-${box.zone}`, stoneTexture(scene, zone.wall, seed + 7)));
        getBatch(`wall-${box.zone}`, () => mat(`wall-${box.zone}`, wallTexture(scene, zone.wall, zone.accent, seed))).box(
          box.min,
          box.max,
          { kind: 'world', tile: 4, vHeight: WALL_HEIGHT },
          true,
          top,
          box.kind === 'raised' ? 4 : 2,
        );
        break;
      }
      case 'pillar':
      case 'rail':
        getBatch(`stone-${box.zone}`, () => mat(`stone-${box.zone}`, stoneTexture(scene, zone.wall, seed + 7))).box(
          box.min,
          box.max,
          { kind: 'world', tile: 2, vHeight: 1.5 },
        );
        break;
      case 'crate':
        getBatch('crate', () => mat('crate', crateTexture(scene, '#a5794b', 11))).box(box.min, box.max, {
          kind: 'box',
          tile: 2,
          vTile: box.max[1] - box.min[1],
        });
        break;
      case 'crate-low':
        getBatch('crate-low', () => mat('crate-low', crateTexture(scene, '#8a6a4a', 23))).box(box.min, box.max, {
          kind: 'box',
          tile: 2,
          vTile: box.max[1] - box.min[1],
        });
        break;
      case 'stack':
        getBatch(`stack-${box.zone}`, () => mat(`stack-${box.zone}`, metalTexture(scene, zone.accent, seed + 3), undefined, 0.15)).box(
          box.min,
          box.max,
          { kind: 'box', tile: 2, vTile: (box.max[1] - box.min[1]) / 2 },
        );
        break;
    }
  }

  addFacadeDetail(data, (key, color, emissive) =>
    getBatch(key, () => {
      const m = mat(key, null, Color3.FromHexString(color), 0.12);
      if (emissive) m.emissiveColor = Color3.FromHexString(emissive);
      return m;
    }, false),
  );

  for (const f of data.floors) {
    const zone = zones[f.zone] ?? Object.values(zones)[0];
    getBatch(`floor-${f.zone}`, () => mat(`floor-${f.zone}`, floorTexture(scene, zone.floor, zoneSeed(f.zone) + 101)), false).floor(
      f.minX,
      f.minZ,
      f.maxX,
      f.maxZ,
      4,
    );
  }

  for (const [key, { batch, material, castShadow }] of batches) {
    const mesh = batch.build(`map-${key}`, scene);
    if (!mesh) continue;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    if (shadow && castShadow) shadow.addShadowCaster(mesh, false);
    meshes.push(mesh);
  }

  // Painted site letters.
  for (const mark of def.siteMarks) {
    const plane = CreatePlane(`site-${mark.letter}`, { size: 5 }, scene);
    plane.rotation.x = Math.PI / 2;
    plane.position.set(data.space.x(mark.c), 0.02, data.space.z(mark.r));
    const m = new StandardMaterial(`site-mat-${mark.letter}`, scene);
    const t = letterTexture(scene, mark.letter, 'rgba(255,255,255,0.55)');
    m.diffuseTexture = t;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(0.15, 0.15, 0.15);
    materials.push(m);
    plane.material = m;
    plane.receiveShadows = true;
    plane.isPickable = false;
    plane.freezeWorldMatrix();
    meshes.push(plane);
  }

  // Sky dome.
  const sky = CreateSphere('sky', { diameter: 600, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial('sky-mat', scene);
  const skyTex = skyTexture(scene, def.palette.sky[0], def.palette.sky[1]);
  skyMat.emissiveTexture = skyTex;
  skyMat.diffuseColor = Color3.Black();
  skyMat.specularColor = Color3.Black();
  skyMat.disableLighting = true;
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  materials.push(skyMat);
  meshes.push(sky);

  for (const m of materials) m.freeze();

  return {
    meshes,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const m of materials) m.dispose(true, true);
    },
  };
}

/** Deterministic hash → [0, 1). */
function h01(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Visual-only facade detail on walls that face open ground: pilasters, doors, high windows and
 * wall lamps. Everything sits within 12 cm of the wall face, so it needs no collision.
 */
function addFacadeDetail(data: MapData, batch: (key: string, color: string, emissive?: string) => GeometryBatch) {
  const { def, space, cellTop } = data;
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const at = (c: number, r: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? def.grid[r][c] : '#');
  const open = (c: number, r: number) => at(c, r) === '.';
  const half = CELL / 2;
  const uv = { kind: 'box' as const, tile: 1, vTile: 1 };
  const seed = [...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 3) | 0;

  // The four facade directions: wall cell (c, r) with open ground at (c + dc, r + dr).
  const dirs: { dc: number; dr: number }[] = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 },
  ];
  for (const { dc, dr } of dirs) {
    const alongRows = dc !== 0; // facade runs along the grid's rows (varies r) when it faces ±X
    const lines = alongRows ? cols : rows;
    const len = alongRows ? rows : cols;
    for (let line = 0; line < lines; line++) {
      let k = 0;
      while (k < len) {
        const c = alongRows ? line : k;
        const r = alongRows ? k : line;
        if (!(at(c, r) === '#' && open(c + dc, r + dr))) {
          k++;
          continue;
        }
        let e = k;
        while (e + 1 < len) {
          const c2 = alongRows ? line : e + 1;
          const r2 = alongRows ? e + 1 : line;
          if (at(c2, r2) === '#' && open(c2 + dc, r2 + dr)) e++;
          else break;
        }
        placeRun(line, k, e);
        k = e + 1;
      }
    }

    function placeRun(line: number, k0: number, k1: number) {
      const n = k1 - k0 + 1;
      // world helpers for a point along the facade (t in cells from k0's near edge) at height y, protruding p
      const cellC = (k: number) => (alongRows ? line : k);
      const cellR = (k: number) => (alongRows ? k : line);
      const zone = def.palette.zones[def.zoneOf(cellC(k0), cellR(k0))] ?? Object.values(def.palette.zones)[0];
      const box = (key: string, color: string, k: number, offset: number, width: number, y0: number, y1: number, depth: number, emissive?: string) => {
        // k: cell index along the run; offset: metres from that cell's centre along the facade
        const c = cellC(k);
        const r = cellR(k);
        const cx = space.x(c) + dc * half;
        const cz = space.z(r) - dr * half; // row grows towards −Z
        const nx = dc;
        const nz = -dr;
        let min: number[];
        let max: number[];
        if (alongRows) {
          // face normal ±X; facade runs along Z (row direction is −Z)
          const z = space.z(r) - offset;
          const x0 = nx > 0 ? cx : cx - depth;
          const x1 = nx > 0 ? cx + depth : cx;
          min = [x0, y0, z - width / 2];
          max = [x1, y1, z + width / 2];
        } else {
          const x = space.x(c) + offset;
          const z0 = nz > 0 ? cz : cz - depth;
          const z1 = nz > 0 ? cz + depth : cz;
          min = [x - width / 2, y0, z0];
          max = [x + width / 2, y1, z1];
        }
        batch(key, color, emissive).box(min, max, uv, true, null);
      };
      const trim = shade(zone.wall, 0.78);
      const frame = shade(zone.accent, 0.55);
      // pilasters at the run ends and every 3 cells
      for (let k = k0; k <= k1 + 1; k += 3) {
        const kk = Math.min(k, k1);
        const off = k > k1 ? 1 : -1;
        const top = cellTop[cellR(kk) * cols + cellC(kk)];
        box(`facade-pilaster-${zone.wall}`, trim, kk, off * (half - 0.02), 0.42, 0, top, 0.1);
        if (k > k1) break;
      }
      // a door on some runs of 3+ cells
      if (n >= 3 && h01(line, k0, seed) < 0.45) {
        const kd = k0 + 1 + Math.floor(h01(k0, line, seed + 1) * (n - 2));
        box('facade-door-frame', frame, kd, 0, 1.75, 0, 2.85, 0.06);
        box('facade-door', '#3a2a22', kd, 0, 1.45, 0, 2.65, 0.09);
        box('facade-door-step', shade(zone.floor, 0.8), kd, 0, 1.9, 0, 0.12, 0.35);
        if (h01(kd, line, seed + 2) < 0.6) box('facade-lamp', '#ffe2a8', kd, 0, 0.32, 3.05, 3.25, 0.12, '#c9a560');
      }
      // high windows and lamps along the rest
      for (let k = k0; k <= k1; k++) {
        const top = cellTop[cellR(k) * cols + cellC(k)];
        const roll = h01(k, line, seed + 7);
        if (roll < 0.34 && top >= 5.2) {
          box('facade-window-frame', frame, k, 0, 1.25, 3.55, 4.95, 0.05);
          box('facade-window', '#1d2a36', k, 0, 1.0, 3.7, 4.8, 0.07, '#0c1620');
          box('facade-sill', trim, k, 0, 1.4, 3.45, 3.58, 0.14);
        } else if (roll > 0.86) {
          box('facade-lamp', '#ffe2a8', k, 0, 0.3, 2.9, 3.1, 0.12, '#c9a560');
        }
      }
    }
  }
}
