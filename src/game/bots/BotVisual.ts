import {
  Color3,
  Constants,
  CreateBox,
  CreateDisc,
  CreatePlane,
  Mesh,
  StandardMaterial,
  TransformNode,
  type Scene,
} from '../rendering/babylon';
import { BOT_SCALE } from './perception/visibility';

const ENEMY_RED = Color3.FromHexString('#ff3b4e');

/** What the simulation needs from a bot's on-screen body (blocky dummy or rigged agent model). */
export interface BotView {
  setVisible(v: boolean): void;
  muzzleFlash(): void;
  hit(): void;
  die(): void;
  revive(): void;
  update(dt: number, x: number, y: number, z: number, yaw: number, aimPitch: number, crouch: number, speed: number, groundY: number): void;
  muzzleWorld(): [number, number, number];
  dispose(): void;
}

/** Shared resources for all bot visuals (geometry templates + materials). */
export class BotAssets {
  readonly shadowMat: StandardMaterial;
  readonly flashMat: StandardMaterial;
  readonly gunMat: StandardMaterial;
  readonly darkMat: StandardMaterial;

  constructor(
    readonly scene: Scene,
    flashTexture: import('../rendering/babylon').Texture,
    shadowTexture: import('../rendering/babylon').Texture,
  ) {
    this.shadowMat = new StandardMaterial('bot-shadow', scene);
    this.shadowMat.diffuseTexture = shadowTexture;
    this.shadowMat.useAlphaFromDiffuseTexture = true;
    this.shadowMat.diffuseColor = Color3.Black();
    this.shadowMat.specularColor = Color3.Black();
    this.shadowMat.disableLighting = true;
    this.shadowMat.zOffset = -1;

    this.flashMat = new StandardMaterial('bot-flash', scene);
    this.flashMat.diffuseTexture = flashTexture;
    this.flashMat.useAlphaFromDiffuseTexture = true;
    this.flashMat.emissiveColor = new Color3(1, 0.8, 0.5);
    this.flashMat.disableLighting = true;
    this.flashMat.alphaMode = Constants.ALPHA_ADD;
    this.flashMat.backFaceCulling = false;

    this.gunMat = new StandardMaterial('bot-gun', scene);
    this.gunMat.diffuseColor = Color3.FromHexString('#1d2026');
    this.gunMat.specularColor = new Color3(0.3, 0.3, 0.3);

    this.darkMat = new StandardMaterial('bot-dark', scene);
    this.darkMat.diffuseColor = Color3.FromHexString('#23262d');
    this.darkMat.specularColor = new Color3(0.1, 0.1, 0.1);
  }

  dispose() {
    this.shadowMat.dispose();
    this.flashMat.dispose();
    this.gunMat.dispose();
    this.darkMat.dispose();
  }
}

/**
 * Stylised humanoid "training agent" built from primitives: readable silhouette,
 * red enemy highlight, crouch / walk / death animation and a muzzle flash.
 */
export class BotVisual implements BotView {
  readonly root: TransformNode;
  private readonly hips: TransformNode;
  private readonly upper: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly gunPivot: TransformNode;
  readonly muzzle: TransformNode;
  private readonly flash: Mesh;
  private readonly shadow: Mesh;
  private readonly bodyMat: StandardMaterial;
  private readonly accentMat: StandardMaterial;
  private readonly meshes: Mesh[] = [];
  private walkPhase = 0;
  private flashTime = 0;
  private hitFlash = 0;
  private deathT = -1;

  constructor(
    private readonly assets: BotAssets,
    id: number,
    outline: boolean,
  ) {
    const scene = assets.scene;
    this.bodyMat = new StandardMaterial(`bot-body-${id}`, scene);
    this.bodyMat.diffuseColor = Color3.FromHexString('#3b4150');
    this.bodyMat.specularColor = new Color3(0.12, 0.12, 0.12);
    this.accentMat = new StandardMaterial(`bot-accent-${id}`, scene);
    this.accentMat.diffuseColor = ENEMY_RED;
    this.accentMat.emissiveColor = ENEMY_RED.scale(0.55);
    this.accentMat.specularColor = new Color3(0.2, 0.2, 0.2);

    this.root = new TransformNode(`bot-${id}`, scene);
    this.root.scaling.setAll(BOT_SCALE); // built at person size, drawn BOT_SCALE larger (matches the hitboxes)
    this.hips = new TransformNode(`bot-${id}-hips`, scene);
    this.hips.parent = this.root;
    this.upper = new TransformNode(`bot-${id}-upper`, scene);
    this.upper.parent = this.hips;

    const box = (
      parent: TransformNode,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: StandardMaterial,
    ) => {
      const m = CreateBox(`bot-${id}-p`, { width: w, height: h, depth: d }, scene);
      m.parent = parent;
      m.position.set(x, y, z);
      m.material = mat;
      m.isPickable = false;
      if (outline) {
        m.renderOutline = true;
        m.outlineColor = ENEMY_RED;
        m.outlineWidth = 0.012;
      }
      this.meshes.push(m);
      return m;
    };

    // legs pivot at the hip
    this.legL = new TransformNode(`bot-${id}-legL`, scene);
    this.legL.parent = this.hips;
    this.legL.position.set(-0.11, 0, 0);
    box(this.legL, 0.17, 0.86, 0.2, 0, -0.43, 0, this.bodyMat);
    box(this.legL, 0.19, 0.12, 0.26, 0, -0.8, 0.03, this.assets.darkMat);
    this.legR = new TransformNode(`bot-${id}-legR`, scene);
    this.legR.parent = this.hips;
    this.legR.position.set(0.11, 0, 0);
    box(this.legR, 0.17, 0.86, 0.2, 0, -0.43, 0, this.bodyMat);
    box(this.legR, 0.19, 0.12, 0.26, 0, -0.8, 0.03, this.assets.darkMat);

    // torso, vest, head
    box(this.upper, 0.5, 0.6, 0.3, 0, 0.3, 0, this.bodyMat);
    box(this.upper, 0.42, 0.34, 0.06, 0, 0.36, 0.17, this.assets.darkMat);
    box(this.upper, 0.52, 0.06, 0.32, 0, 0.55, 0, this.accentMat);
    box(this.upper, 0.26, 0.28, 0.27, 0, 0.75, 0.02, this.bodyMat);
    box(this.upper, 0.22, 0.06, 0.04, 0, 0.78, 0.16, this.accentMat); // visor
    box(this.upper, 0.28, 0.06, 0.29, 0, 0.9, 0.02, this.assets.darkMat); // helmet cap

    // arms + gun
    this.gunPivot = new TransformNode(`bot-${id}-gun`, scene);
    this.gunPivot.parent = this.upper;
    this.gunPivot.position.set(0.08, 0.42, 0.12);
    box(this.gunPivot, 0.12, 0.12, 0.42, -0.24, -0.04, 0.05, this.bodyMat); // left arm
    box(this.gunPivot, 0.12, 0.12, 0.32, 0.12, -0.06, -0.04, this.bodyMat); // right arm
    const gun = CreateBox(`bot-${id}-rifle`, { width: 0.07, height: 0.09, depth: 0.7 }, scene);
    gun.parent = this.gunPivot;
    gun.position.set(0, 0.02, 0.3);
    gun.material = this.assets.gunMat;
    gun.isPickable = false;
    this.meshes.push(gun);
    this.muzzle = new TransformNode(`bot-${id}-muzzle`, scene);
    this.muzzle.parent = this.gunPivot;
    this.muzzle.position.set(0, 0.03, 0.68);

    this.flash = CreatePlane(`bot-${id}-flash`, { size: 0.45 }, scene);
    this.flash.parent = this.muzzle;
    this.flash.material = this.assets.flashMat;
    this.flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.flash.isPickable = false;
    this.flash.setEnabled(false);

    this.shadow = CreateDisc(`bot-${id}-blob`, { radius: 0.42, tessellation: 18 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = this.assets.shadowMat;
    this.shadow.isPickable = false;
  }

  setVisible(v: boolean) {
    this.root.setEnabled(v);
    this.shadow.setEnabled(v);
  }

  muzzleFlash() {
    this.flashTime = 0.05;
  }

  hit() {
    this.hitFlash = 0.09;
  }

  die() {
    this.deathT = 0;
  }

  revive() {
    this.deathT = -1;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
  }

  update(
    dt: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    aimPitch: number,
    crouch: number,
    speed: number,
    groundY: number,
  ) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const legH = 0.86 - 0.55 * crouch;
    this.hips.position.y = legH;
    const legScale = legH / 0.86;
    // crouched legs fold (scale) + walking swing
    const moving = Math.min(1, speed / 5.4);
    this.walkPhase += dt * (4 + speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.55 * moving;
    this.legL.scaling.y = legScale;
    this.legR.scaling.y = legScale;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.gunPivot.rotation.x = -aimPitch;

    this.shadow.position.set(x, groundY + 0.015, z);

    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.35);
      this.root.rotation.x = -t * 1.35;
      this.root.position.y = y - t * 0.15;
    }

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flash.setEnabled(true);
      this.flash.rotation.z = Math.random() * 6.28;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scaling.set(s, s, s);
    } else this.flash.setEnabled(false);

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.bodyMat.emissiveColor.set(0.9, 0.9, 0.9);
    } else {
      this.bodyMat.emissiveColor.set(0.05, 0.05, 0.07);
    }
  }

  muzzleWorld(): [number, number, number] {
    const p = this.muzzle.getAbsolutePosition();
    return [p.x, p.y, p.z];
  }

  dispose() {
    for (const m of this.meshes) m.dispose();
    this.flash.dispose();
    this.shadow.dispose();
    this.root.dispose();
    this.bodyMat.dispose();
    this.accentMat.dispose();
  }
}
