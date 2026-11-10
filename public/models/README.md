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
- `sheriff.glb`: "[Arcane Sheriff](https://sketchfab.com/3d-models/arcane-sheriff-9d817055d22543b8a4a5992f68a35b33)"
  by [ILilMitch](https://sketchfab.com/ILilMitch), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

The skins are Valorant designs owned by Riot Games, so the same free, non-commercial fan-project rule applies.

## Changes made to the originals

All three were recentred and their textures resized to 1024 px and converted to WebP (`gltf-transform center`,
`resize`, `webp`, `prune`). The Phantom was also welded, simplified from about 225k to 37k triangles and
quantized (`weld`, `simplify --ratio 0.06 --error 0.01`, `quantize`).

# First-person arms (`fp-arms.glb`)

Used for the player's arms when **Settings → Graphics → First-person arms** is set to *Rigged arms* (the default).
If the file is missing or isn't the expected model, the game uses its built-in arms (simple shapes, no file needed).

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
They play the pack's own draw, fire and reload animations with the game's guns attached; pistols, which the
pack has no animations for, are held by solving the arms onto the gun. If the file is missing or isn't the
expected pack, the game falls back to `fp-arms.glb`, then to its built-in arms.

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

