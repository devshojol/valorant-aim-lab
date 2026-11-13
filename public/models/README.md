# Bot character model

`sage.glb` is used for the bots when **Settings → Graphics → Bot model** is set to *Sage* (the default).
If the file is missing or fails to load, the game falls back to the built-in blocky training dummy.

## Credit (CC BY 4.0)

"[Sage | Valorant](https://sketchfab.com/3d-models/sage-valorant-17612cddefbc4f92acddc5fe76625bc2)" by
[ILilMitch](https://sketchfab.com/ILilMitch), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

The author's notes: Sage was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
Riot Games does not endorse or sponsor this project. The author is not affiliated with Riot Games, and distributes the
model free of charge for educational and personal use, in line with Riot Games' policies.

Keep this project free and non-commercial while it includes this model. It is not included in the single-file build.

## Changes made to the original

Made with `scripts/prepare-agent-model.mjs` (see its header for the exact steps):

- recentred so the feet stand on the origin,
- textures resized from 2048 px to 1024 px and converted to WebP,
- mesh simplified to about half the triangles (≈ 37k → 20k),
- skeleton reduced from 261 to 31 joints (face, hair, cloth, finger and weapon joints merged into their parents).

# Weapon skins (`weapons/`)

Used for the first-person guns when **Settings → Graphics → Gun models** is set to *Skins* (the default);
Sage bots carry the Vandal. A missing or broken file falls back to the simple built-in gun.
The grip, support-hand, muzzle and sight points measured on each model live in `src/game/weapons/WeaponSkins.ts`.

## Credits (CC BY 4.0)

- `vandal.glb`: "[Gaia Vandal (Orange)](https://sketchfab.com/3d-models/gaia-vandal-orange-46e6e410115441c182efab311d557532)"
  by [ILilMitch](https://sketchfab.com/ILilMitch), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `phantom.glb`: "[Phantom - Reaver (White Variant) Valorant](https://sketchfab.com/3d-models/phantom-reaver-white-variant-valorant-399ea10e99b5459cbf892498c7c258fc)"
  by [MisterM4n](https://sketchfab.com/MisterM4n), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `sheriff.glb`: "[Valorant Sheriff](https://sketchfab.com/3d-models/valorant-sheriff-a9d26172689e407eb43726ab9a0e4d68)"
  by [sn00p](https://sketchfab.com/sn00ps), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `classic.glb`: "[Prime Classic | Valorant](https://sketchfab.com/3d-models/prime-classic-valorant-ba82312c24cf4b89a6b34030b764947f)"
  by [ILilMitch](https://sketchfab.com/ILilMitch), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `ghost.glb`: "[Hush Ghost - Valorant](https://sketchfab.com/3d-models/hush-ghost-valorant-83057f92de2d4de4b5336cffa6e7b622)"
  by [Jp André](https://sketchfab.com/JpAndre), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/)
  (non-commercial only).
- `spectre.glb`: "[Spectre Sentinel of Light - Valorant](https://sketchfab.com/3d-models/spectre-sentinel-of-light-valorant-edba041c6f1840d0851eeeb6e6bc5e2e)"
  by [Kairos.](https://sketchfab.com/KairosBastardville), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `guardian.glb`: "[Valorant guardian - standard skin](https://www.thingiverse.com/thing:6331578)"
  by Swierszcz93 on Thingiverse, licensed under [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/)
  (this modified version is shared under the same licence).
- `operator.glb`: "[KURONAMI Operator - Valorant Skin](https://sketchfab.com/3d-models/kuronami-operator-valorant-skin-637801735b3e4d6f8d98d52f64450b4c)"
  by [neumann](https://sketchfab.com/neumann18), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

All eight skins are Valorant designs owned by Riot Games, so the same free, non-commercial fan-project rule applies
(the Ghost's own licence is non-commercial as well).

## Changes made to the originals

The Classic, Ghost, Spectre, Guardian, Operator and Sheriff were prepared with `scripts/prepare-weapon-skin.mjs`
(see its header): the Classic's skinned mesh baked in its bind pose, skins and the Ghost's ground plane removed,
every part baked into one space with the barrel along +Z and scaled to metres, meshes joined, simplified to
6k–16k triangles (the Sheriff from about 1.5M), and textures resized to 1024 px WebP.
The Operator's skinned mesh was baked in its bind pose and its animation rig dropped; its magazine and its bolt
(the triangles skinned to the bolt joints) are kept as separate nodes, `mag` and `bolt`, which the game moves
for the reload and for working the bolt after each shot.
The Guardian was converted from two 3D-print STL files: its magazine (exported at the print origin) moved into the
mag well. The Guardian and Sheriff have no textures in the originals, so both get a flat gunmetal material.

The Vandal and Phantom were recentred and their textures resized to 1024 px and converted to WebP (`gltf-transform center`,
`resize`, `webp`, `prune`). The Phantom was also welded, simplified from about 225k to 37k triangles and
quantized (`weld`, `simplify --ratio 0.06 --error 0.01`, `quantize`).

# First-person arms (`fp-arms.glb`)

Used for the player's arms when **Settings → Graphics → First-person arms** is set to *Rigged arms*, and as the fallback
when the animated arms can't load. If the file is missing or isn't the expected model, the game uses its built-in arms
(simple shapes, no file needed).

## Credit (CC BY 4.0)

"[First-Person Arm & Hand - Fingerless Gloves](https://sketchfab.com/3d-models/first-person-arm-hand-fingerless-gloves-1db487dc4cda4c2e93e79e7989eb587d)"
by [Exactly](https://sketchfab.com/txyrm70), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

## Changes made to the original

- Textures converted from PNG to WebP (`gltf-transform webp --quality 82`, then `prune`): 4.2 MB → 1.1 MB.
- The file itself is otherwise unchanged. The model has no skeleton, so `src/game/weapons/ArmModel.ts` cuts out the
  two arms when it loads and skins them in code (forearm, hand, three joints per finger and thumb), using joint
  positions measured on this file.

# Animated first-person arms (`fp-arms-anim.glb`)

Used for the player's arms when **Settings → Graphics → First-person arms** is set to *Animated* (the default).
They play the pack's own draw, fire and reload animations with the game's rifles attached. Sidearms use the
pistol arms below; without that file, these arms are posed onto the pistol instead. If this file is missing or
isn't the expected pack, the game falls back to `fp-arms.glb`, then to its built-in arms.

## Credit (CC BY 4.0)

"[M4 - FPS Weapon Animations Pack (v.1)](https://sketchfab.com/3d-models/m4-fps-weapon-animations-pack-v1-662fc74dda2646cfb48fc610705768ef)"
by [BarcodeGames](https://sketchfab.com/barcodegames), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

## Changes made to the original

Made with `scripts/prepare-fp-arms.mjs` (11.5 MB → 1.1 MB):

- materials converted from specular/glossiness to metal/roughness,
- the M4 rifle, its magazines, bullets, bolt, trigger and safety lost their meshes (their joints and all
  animations are kept; the game attaches its own guns to the weapon joint and moves its own magazine with the
  pack's magazine joints),
- textures resized to at most 1024 px and converted to WebP,
- unused data pruned.

# Animated pistol arms (`fp-arms-pistol.glb`)

Used with the animated arms for the sidearms (Classic, Ghost, Sheriff): the same gloved arms in a two-handed
pistol hold, with the pack's own draw, shoot and reload animations. The game's pistol rides the pack's weapon
joint, scaled so its grip fits the hands, and its magazine follows the pack's magazine joint.

## Credit

"[Mark 23 Animated (Free)](https://sketchfab.com/3d-models/mark-23-animated-free-7abebe340aca4f46b36368417b3ca920)"
by [BarcodeGames](https://sketchfab.com/barcodegames). The downloaded file names its licence as the
**Sketchfab Standard licence** (https://sketchfab.com/licenses), not Creative Commons: check its terms before
publishing this file in a public repository or build.

## Changes made to the original

Made with `scripts/prepare-fp-arms-pistol.mjs` (2.3 MB → 0.36 MB):

- the Mark 23 pistol (frame, slide, magazine) lost its meshes; every joint and animation is kept,
- textures resized to at most 1024 px and converted to WebP,
- duplicate data merged, redundant keyframes removed, unused data pruned.

# Compression

After the per-model steps above, every GLB here was run through `scripts/compress-models.mjs`: vertices welded,
normals, tangents, UVs, joints and weights stored quantized (`KHR_mesh_quantization`; positions too on unskinned
models), redundant animation keyframes removed, and the Phantom simplified again (about 37k → 17k triangles).
Total size went from 7.0 MB to 3.9 MB.
