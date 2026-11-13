# Plan: realistic map visuals

The next piece of work. The goal is maps that look like places in Valorant instead of coloured boxes,
without changing how they play.

## Where we are

- A map is a character grid (`src/game/maps/<theme>/<map>.ts`). `MapData` turns it into merged boxes, and
  the same boxes are used for collision, navigation, enemy-spot generation and rendering.
- `MapRenderer` batches those boxes into a few meshes with `StandardMaterial` and world-space UVs.
  Textures are drawn on 256–512 px canvases (`rendering/textures.ts`): one wall, floor, crate, metal and
  stone pattern, tinted per zone.
- Dressing is light: stepped wall heights, arches and crates in long corridors, flat facade detail (doors,
  windows, lamps, pilasters) and site letters on the ground.
- Lighting is one hemispheric light, a sun with one shadow map, an optional fill light, exponential fog and
  a gradient sky sphere. Post-processing is a setting but does little for the map.

So every map reads as the same box kit in a different colour, with flat lighting.

## What "like Valorant" means

Valorant's maps are stylised, not photoreal. What makes them look the way they do:

1. **Clean, readable shapes.** Big flat surfaces, crisp bevelled edges, very little noise at head height.
2. **Hand-painted materials.** Soft gradients and large brush shapes, restrained normal detail, matte
   surfaces with a few glossy accents.
3. **Soft baked lighting.** Warm sun, cool shadow, ambient occlusion in corners, light bouncing colour
   between walls. Shadows are soft and never black.
4. **Trim and architecture.** Skirting, cornices, door and window frames with real depth, roofs, awnings.
5. **A strong identity per map.** One palette, one building style, one landmark per site, a vista beyond
   the walls.
6. **Dressing that never blocks play.** Props sit against walls and above head height.

## Rules for this work

- **Collision does not change.** Boxes stay the single source for collision, navigation and enemy spots.
  Everything here is a visual layer on top. A visual may stand proud of its collision box by at most
  3 cm on a face a player can touch or peek past, so what you see is still what blocks you.
- **Enemies stay readable.** No busy textures or strong contrast at 1–2 m height on walls behind common
  peek lines. Check every pass with bots standing in the usual spots.
- **Every phase ships on its own** and keeps `npm test` and the map tests green.
- **Presets still work.** Potato and Low keep today's cost. New work is switched on from Medium up and
  falls back cleanly. The single-file build keeps using procedural textures only.
- **Clean assets.** Nothing extracted from the game. Textures and props are made in code or come from
  CC0 / CC BY sources, recorded in a credits file like `public/models/README.md`.

## Phases

### Phase 0: tooling and a baseline

- A fixed-camera screenshot script: every map, three or four views per location, at each preset
  (extend `scripts/e2e-maps.mjs`). Before/after pictures for every later phase.
- A free-fly debug camera next to `debug.spectate()`.
- A frame-time and draw-call readout per map, and a budget: High holds 144 fps on a mid-range GPU,
  Low holds 60 fps on integrated graphics.
- A reference board per map: 8–10 screenshots of the map it is inspired by, with notes on palette,
  materials and landmark shapes.

Done when the script produces the picture set and the numbers for all eight maps.

### Phase 1: lighting and atmosphere

The biggest change for the least content.

- Move map materials to PBR (`PBRMaterial`, metal/roughness) with an image-based environment light
  generated per map from its sky.
- Sky: a painted gradient with sun disc, haze and cloud layer per map instead of the two-colour sphere.
- Sun: cascaded shadow maps with soft filtering, shadow colour tinted cool, sun tinted per map.
- Ambient occlusion baked per vertex from the grid (wall-floor and wall-wall corners, under arches),
  plus SSAO on High.
- Baked bounce light: a low-resolution lightmap or per-vertex colour computed from the grid once at
  load (sun visibility plus one bounce), cached per map.
- Tone mapping and colour grading per map (ACES, a look-up table per theme), light bloom on bright
  sky and lamps, fog colour and density per map.

Done when a grey-box map already looks lit: soft corners, warm and cool sides, readable depth.

### Phase 2: materials and textures

- A material set per theme (5–8 materials: plaster, stone block, brick, wood, painted metal, concrete,
  ground tile, dirt), each with albedo, normal, roughness and AO at 1024 px, 2048 px on High.
  Source: CC0 libraries (ambientCG, Poly Haven) repainted towards the stylised look, or generated in
  code where a pattern is simple.
- Each grid zone picks materials by surface: wall base, wall upper, floor, trim, crate. `MapBox` gains
  a surface id; `MapPalette` gains a material table.
- Wall variation without tiling: a base band and an upper band, vertex-colour gradients (darker at the
  ground, lighter at the top), large-scale tint noise, edge wear on corners.
- Decals: dirt where walls meet the floor, cracks, stains, paint strips, posters and signs, callout
  names painted on walls, better site letters.
- Compressed textures (KTX2 / Basis) and one texture array per theme to keep draw calls down.

Done when walls, floors and crates no longer look like one pattern with a tint.

### Phase 3: architecture as a visual layer

Generated from the grid, so all eight maps benefit and no one has to model them by hand.

- Bevelled outer corners and wall caps instead of raw box edges.
- Skirting along the floor and a cornice at the wall top, following the stepped wall heights.
- Doors, windows and arches with real depth: frames, sills, shutters, recessed dark interiors.
- Roofs on buildings: tiled slopes, flat roofs with parapets, awnings over doorways.
- Pillars, rails and stairs get proper profiles; raised floors get edging and steps.
- A kit per theme (profiles and proportions as data), so the piazza, the bazaar and the container yard
  build different shapes from the same rules.

New code: `src/game/rendering/mapkit/` (profiles, extrusion, placement rules) called from `MapRenderer`.
Done when a wall reads as a building facade from any gameplay position.

### Phase 4: props, vistas and set dressing

- Replace box crates with themed props on the same collision boxes: wooden crates, shipping
  containers, barrels, planters, market stalls, sandbags, generators.
- Non-colliding dressing above head height and against walls: lamps, cables, pipes, air-conditioning
  units, signs, flags, plants, balconies.
- Outside the walls: a skyline, hills, sea or forest per map as low-detail geometry, so the map sits
  in a place instead of ending at a wall.
- Props come from a small GLB kit per theme (CC0 / CC BY, or modelled for the project), drawn with
  instancing. Budget: under 2 MB of props per theme, loaded with the map.

Done when each site has a recognisable landmark and no location looks empty.

### Phase 5: per-map art pass

One map at a time, in this order (the first is the vertical slice that proves phases 1–4):

| Order | Map        | Inspired by | Theme to build towards                                    |
| ----- | ---------- | ----------- | --------------------------------------------------------- |
| 1     | Vellora    | Ascent      | Sun-baked Mediterranean piazza: plaster, terracotta, stone |
| 2     | Dunehold   | Bind        | Desert bazaar: sandstone, painted doors, cloth awnings     |
| 3     | Sanctum    | Haven       | Hillside monastery: timber, white walls, garden stone      |
| 4     | Kitsune    | Split       | Vertical neon city: concrete, glass, signs, night accents  |
| 5     | Goldline   | Sunset      | Golden-hour city streets: stucco, murals, shopfronts       |
| 6     | Tamarind   | Lotus       | Jungle temple ruins: carved stone, moss, water             |
| 7     | Permafrost | Icebox      | Arctic container yard: steel, snow, ice, floodlights       |
| 8     | Coralis    | Breeze      | Tropical island fort: weathered stone, sand, palms, sea    |

Per map: palette and grading, material choices, kit settings, landmark per site, vista, signage, then a
readability check with bots in the generated spots.

### Phase 6: surface effects and ambience

- Bullet holes, sparks and impact sounds by surface (plaster, wood, metal, stone).
- Footstep sounds by floor material.
- Ambient particles and sound per map: dust in sun shafts, falling snow, leaves, distant city or sea.
- Contact shadows under props and a soft shadow under the player's gun.

### Phase 7: performance and presets

- Static batching per material, instancing for props, frozen world matrices and materials.
- Visibility from the grid: a potentially-visible set per cell, so rooms behind walls aren't drawn.
- Preset mapping: Potato and Low keep vertex AO and procedural textures; Medium adds PBR sets, the
  kit and props; High adds 2048 px textures, SSAO, bloom, cascades and ambient particles.
- Load time: textures and props streamed after the map is playable; measure download size per map.

## Suggested first milestone

A vertical slice on **Vellora, A Main**: phase 0, then phases 1–3 for that map only, with a few phase 4
props. It shows the target look in one location within the first stretch of work, and it settles the
open questions below before the other seven maps are touched.

## Open questions to settle first

1. **Style target:** stylised and clean like Valorant (this plan), or closer to photoreal?
2. **Where assets come from:** generated in code plus CC0 libraries (no modelling tools needed), or
   props modelled in Blender for the project?
3. **Download budget:** how much may one map add? This plan assumes about 5–8 MB per theme on Medium
   and High, nothing extra on Potato and Low.
4. **Lowest machine to support** at Medium, which decides how much lighting is baked versus real-time.
5. **Map layouts:** stay as they are (visual pass only), or should some be reshaped to sit closer to
   the maps they are inspired by? Reshaping means regenerating enemy spots and re-testing.

## Risks

- **Readability:** richer backgrounds make enemies harder to see. Mitigation: the readability rule
  above, checked per map.
- **Frame rate:** PBR, cascades and props cost more than today. Mitigation: phase 0 budgets and
  phase 7 before the per-map passes pile content on.
- **Visual and collision drift:** bevelled or framed geometry that hides a peek line. Mitigation: the
  3 cm rule, and a debug overlay that draws collision boxes over the visual layer.
- **Scope:** eight maps is a lot of art. Mitigation: everything in phases 1–3 is generated from the
  grid, and the per-map pass is data (palette, kit settings, prop lists), not hand modelling.
