import {
  Color3,
  Color4,
  Constants,
  CreateBox,
  CreatePlane,
  Mesh,
  ParticleSystem,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
  type Scene,
} from './babylon';
import { bulletHoleTexture, radialTexture } from './textures';

interface Tracer {
  mesh: Mesh;
  from: Vector3;
  dir: Vector3;
  length: number;
  traveled: number;
  speed: number;
  active: boolean;
}

/**
 * Pooled bullet effects: wall decals (instanced), spark bursts, hit puffs and tracers.
 */
export class Effects {
  private readonly holeBase: Mesh;
  private readonly holes: (Mesh | InstancedMesh)[] = [];
  private holeIndex = 0;
  private readonly sparks: ParticleSystem;
  private readonly hitPuffs: ParticleSystem;
  private readonly tracers: Tracer[] = [];
  private readonly sparkEmitter = new Vector3();
  private readonly hitEmitter = new Vector3();
  private readonly tmp = new Vector3();

  constructor(scene: Scene, quality: 'low' | 'medium' | 'high') {
    const holeCount = quality === 'high' ? 96 : quality === 'medium' ? 48 : 20;
    const hm = new StandardMaterial('fx-hole', scene);
    hm.diffuseTexture = bulletHoleTexture(scene);
    hm.useAlphaFromDiffuseTexture = true;
    hm.specularColor = Color3.Black();
    hm.zOffset = -2;
    this.holeBase = CreatePlane('fx-hole-base', { size: 0.09 }, scene);
    this.holeBase.material = hm;
    this.holeBase.isPickable = false;
    this.holeBase.position.y = -50;
    this.holes.push(this.holeBase);
    for (let i = 1; i < holeCount; i++) {
      const inst = this.holeBase.createInstance(`fx-hole-${i}`);
      inst.position.y = -50;
      inst.isPickable = false;
      this.holes.push(inst);
    }

    const dot = radialTexture(scene, 'fx-dot', 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32);

    this.sparks = new ParticleSystem('fx-sparks', quality === 'low' ? 120 : 400, scene);
    this.sparks.particleTexture = dot;
    this.sparks.emitter = this.sparkEmitter;
    this.sparks.minEmitBox = new Vector3(0, 0, 0);
    this.sparks.maxEmitBox = new Vector3(0, 0, 0);
    this.sparks.color1 = new Color4(1, 0.85, 0.5, 1);
    this.sparks.color2 = new Color4(1, 0.6, 0.2, 1);
    this.sparks.colorDead = new Color4(0.3, 0.25, 0.2, 0);
    this.sparks.minSize = 0.02;
    this.sparks.maxSize = 0.06;
    this.sparks.minLifeTime = 0.12;
    this.sparks.maxLifeTime = 0.35;
    this.sparks.minEmitPower = 2;
    this.sparks.maxEmitPower = 5;
    this.sparks.gravity = new Vector3(0, -9, 0);
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.sparks.emitRate = 0;
    this.sparks.manualEmitCount = 0;
    this.sparks.start();

    this.hitPuffs = new ParticleSystem('fx-hit', quality === 'low' ? 60 : 200, scene);
    this.hitPuffs.particleTexture = dot;
    this.hitPuffs.emitter = this.hitEmitter;
    this.hitPuffs.minEmitBox = new Vector3(0, 0, 0);
    this.hitPuffs.maxEmitBox = new Vector3(0, 0, 0);
    this.hitPuffs.color1 = new Color4(1, 0.25, 0.3, 1);
    this.hitPuffs.color2 = new Color4(1, 0.55, 0.35, 1);
    this.hitPuffs.colorDead = new Color4(0.4, 0.05, 0.08, 0);
    this.hitPuffs.minSize = 0.05;
    this.hitPuffs.maxSize = 0.12;
    this.hitPuffs.minLifeTime = 0.15;
    this.hitPuffs.maxLifeTime = 0.3;
    this.hitPuffs.minEmitPower = 1;
    this.hitPuffs.maxEmitPower = 3;
    this.hitPuffs.gravity = new Vector3(0, -4, 0);
    this.hitPuffs.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.hitPuffs.emitRate = 0;
    this.hitPuffs.start();

    const tm = new StandardMaterial('fx-tracer', scene);
    tm.emissiveColor = new Color3(1, 0.85, 0.45);
    tm.diffuseColor = Color3.Black();
    tm.specularColor = Color3.Black();
    tm.disableLighting = true;
    tm.alpha = 0.85;
    tm.alphaMode = Constants.ALPHA_ADD;
    const count = quality === 'low' ? 8 : 20;
    for (let i = 0; i < count; i++) {
      const m = CreateBox(`fx-tracer-${i}`, { width: 0.012, height: 0.012, depth: 1 }, scene);
      m.material = tm;
      m.isPickable = false;
      m.setEnabled(false);
      this.tracers.push({ mesh: m, from: new Vector3(), dir: new Vector3(), length: 0, traveled: 0, speed: 0, active: false });
    }
  }

  wallImpact(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    const hole = this.holes[this.holeIndex];
    this.holeIndex = (this.holeIndex + 1) % this.holes.length;
    hole.position.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    // orient plane (-Z normal) to face along +normal
    this.tmp.set(x - nx, y - ny, z - nz);
    hole.lookAt(this.tmp);
    hole.rotation.z = Math.random() * Math.PI * 2;

    this.sparkEmitter.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    this.sparks.direction1 = new Vector3(nx - 0.6, ny + 0.4, nz - 0.6);
    this.sparks.direction2 = new Vector3(nx + 0.6, ny + 1.0, nz + 0.6);
    this.sparks.manualEmitCount = 7;
  }

  fleshImpact(x: number, y: number, z: number, headshot: boolean) {
    this.hitEmitter.set(x, y, z);
    this.hitPuffs.direction1 = new Vector3(-1, -0.2, -1);
    this.hitPuffs.direction2 = new Vector3(1, 1, 1);
    this.hitPuffs.manualEmitCount = headshot ? 14 : 7;
  }

  tracer(from: [number, number, number], to: [number, number, number], speed = 320) {
    const t = this.tracers.find((tr) => !tr.active);
    if (!t) return;
    t.from.set(from[0], from[1], from[2]);
    t.dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    t.length = t.dir.length();
    if (t.length < 1.5) return;
    t.dir.scaleInPlace(1 / t.length);
    t.traveled = 0;
    t.speed = speed;
    t.active = true;
    t.mesh.setEnabled(true);
    t.mesh.lookAt(this.tmp.copyFrom(t.from).addInPlace(t.dir));
    this.place(t);
  }

  private place(t: Tracer) {
    const seg = Math.min(4, t.length - t.traveled);
    const mid = t.traveled + seg / 2;
    t.mesh.position.set(t.from.x + t.dir.x * mid, t.from.y + t.dir.y * mid, t.from.z + t.dir.z * mid);
    t.mesh.scaling.z = Math.max(0.01, seg);
  }

  update(dt: number) {
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.traveled += t.speed * dt;
      if (t.traveled >= t.length) {
        t.active = false;
        t.mesh.setEnabled(false);
        continue;
      }
      this.place(t);
    }
  }

  dispose() {
    this.sparks.dispose();
    this.hitPuffs.dispose();
    for (const h of this.holes) h.dispose();
    for (const t of this.tracers) t.mesh.dispose();
  }
}
