/**
 * Single import surface for Babylon.js. Deep (non-pure) module paths keep the bundle
 * tree-shaken while still registering the side-effects (scene components) we rely on.
 */

export { Engine } from '@babylonjs/core/Engines/engine';
export { Effect } from '@babylonjs/core/Materials/effect';
export type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
export { Scene } from '@babylonjs/core/scene';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { Camera } from '@babylonjs/core/Cameras/camera';
export { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
export { Skeleton } from '@babylonjs/core/Bones/skeleton';
export { Bone } from '@babylonjs/core/Bones/bone';
export { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
export { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
export { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
export { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
export { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
export { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
export { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess';
import '@babylonjs/core/Rendering/outlineRenderer';
export { Constants } from '@babylonjs/core/Engines/constants';
