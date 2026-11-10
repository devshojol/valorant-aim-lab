# Tactical Aim Lab

A browser-based 3D tactical FPS aim-practice lab inspired by Valorant. Open it in Chrome, pick a map location, set your sensitivity and crosshair, choose a weapon and fight AI bots that peek, swing, spray and reposition the way real players do.

It's a fan-made training tool and isn't affiliated with Riot Games. The maps, weapons and the fallback training-dummy bots are original and generated procedurally at runtime. The bots use the "Sage | Valorant" model by ILilMitch (CC BY 4.0, made from Riot Games assets under Riot's fan-content policy, see `public/models/README.md`), and the Vandal, Phantom and Sheriff use community skin models (Gaia Vandal and Arcane Sheriff by ILilMitch, Reaver Phantom by MisterM4n, all CC BY 4.0). The animated first-person arms use the "M4 - FPS Weapon Animations Pack (v.1)" by BarcodeGames (CC BY 4.0, rifle removed), and the alternative posed arms use "First-Person Arm & Hand - Fingerless Gloves" by Exactly (CC BY 4.0). Keep the project free and non-commercial. Gunshots are synthesised at runtime too, except the Vandal, Phantom and Sheriff, which use recordings supplied by the project owner (`public/sounds/`, see below).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build into dist/
npm run build:single # one self-contained HTML file in dist-single/ (no models or recordings)
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
```

Headless gameplay smoke test (Chromium + SwiftShader, needs Playwright installed globally):

```bash
npm run build && npx vite preview --port 4173 &
node scripts/e2e.mjs http://localhost:4173/ e2e-shots
```

## Stack

- **Babylon.js 9** for rendering, the camera, materials, shadows and particles. Babylon is imported by deep paths (`src/game/rendering/babylon.ts`) so the bundle stays tree-shaken.
- **TypeScript** throughout.
- **React 19, Vite 8, Tailwind CSS 4 and Lucide** for the UI.
- **Web Audio API** for HRTF positional audio. Every sound is synthesised at load, so the app works with no audio files; recordings in `public/sounds/` are optional overrides.
  - Gunshots are built from layers (`src/game/audio/gunSynth.ts`): supersonic crack, muzzle blast, body punch, sub thump, mechanical action, early wall reflections and a convolution reverb tail. They're rendered with an `OfflineAudioContext`, with 4 variations per weapon so sprays don't sound looped.
  - Enemy gunshots play the same recording, at the same clarity and level, as the player's own gun of that type (bots carry the Vandal). They're only panned left/right towards the shooter and get a little quieter with distance (down to half volume): no muffling, wall filtering or echo. Other enemy sounds (footsteps, bullet whizz) are still positioned in 3D, muffled with distance and behind walls, and sent to an environment reverb.
  - Recorded takes in `public/sounds/` (listed in its `manifest.json`) override the synthesis per slot: each gun, footsteps, reloads (shared or per gun), the headshot ping and kill-streak sounds 1–5 (shared or per gun). The slots are listed in `public/sounds/README.md`. Recordings are cleaned up when they load: leading and trailing silence is trimmed, a long footstep take is cut into single steps, and footsteps, kill sounds and reloads each play one voice at a time (a new one fades out the previous one) so they never pile up. The Vandal, Phantom and Sheriff shots currently use 3–4 takes each, cut from the owner's recordings by `scripts/extract-gun-samples.py`; every other slot is empty and stays synthesised. The single-file build leaves these files out.
- **Pointer Lock API** with `unadjustedMovement` (raw input) for aiming.
- **localStorage** for settings, crosshair presets and session history.

## Architecture

```
src/
  app/App.tsx                 shell + navigation (8 pages)
  pages/                      Home, Practice, Maps, Weapons, Crosshair, Sensitivity, Statistics, Settings, Game
  components/                 UI kit, MapPreview (top-down SVG + live field-of-view), charts, HUD, report
  hooks/useAppStore.ts        tiny external store (useSyncExternalStore) + persistence
  services/storage.ts         versioned localStorage with defaults merging
  settings/defaults.ts        settings, difficulty presets, eDPI / cm-per-360 maths
  types/                      shared interfaces (weapon, bot, map, practice, crosshair, sensitivity, stats, HUD)
  game/
    engine/GameEngine.ts      the only React↔Babylon boundary: create/start/pause/end/updateSettings + events
    engine/RenderHost.ts      one Babylon engine + canvas reused by every session (compiled shaders stay cached)
    core/Input.ts             keyboard/mouse, pointer lock, raw deltas consumed once per frame
    physics/CollisionWorld.ts AABB world: slab raycasts, kinematic movement (slide, step-up, ground snap), hitboxes
    player/PlayerController   Valorant-scale look (0.07°/count), run/walk/crouch/jump, counter-strafe friction
    weapons/                  per-weapon configs + recoil patterns, WeaponSystem (spread, recoil, ADS, burst, reload), ViewModel,
                              AnimatedArms (animated arms pack), FirstPersonArms (IK arms), ArmModel (skins fp-arms.glb at load)
    bots/
      Bot.ts                  entity: perception, reaction delay, aim-error model, bursts, recoil control, movement
      BotVisual.ts            BotView interface + procedural blocky dummy (fallback) with enemy highlight
      AgentVisual.ts          rigged agent model (public/models/sage.glb) posed in code: crouch, walk cycle,
                              aim pitch, two-bone IK for both arms on the rifle and both legs
      behaviors/              PeekBehavior (angle-hold/jiggle modes), DeathmatchBehavior (roam/hunt/cover/re-peek)
      perception/             FOV + multi-point raycast line of sight, peek-line exposure analysis
      navigation/             grid A* with step heights, drops, corner rules and path smoothing
    maps/                     grid-authored maps → merged boxes (render + collision + nav from one source)
    practice/                 PracticeDirector (modes, spawns, respawns), SessionTracker (stats + scoring)
    rendering/                MapRenderer (batched world-UV geometry), procedural textures, pooled Effects
    audio/AudioEngine.ts      synthesised SFX, HRTF panning, distance and wall-occlusion filtering, reverb send
    audio/gunSynth.ts         layered offline-rendered gunshots (crack/blast/body/sub/mechanics/reflections/reverb)
    hud/crosshairRenderer.ts  screen-space crosshair, shared by the editor preview and the in-game HUD
    hud/Minimap.ts            rotating minimap drawn on the overlay canvas (pre-rendered from the map grid)
public/
  favicon.svg                 crosshair icon (inlined as a data URI in the single-file build)
  models/                     agent, arms and weapon-skin GLBs with their credits (README.md)
  sounds/                     optional recordings that replace synthesised sounds (README.md lists the slots)
scripts/                      single-file build, Playwright smoke tests, asset preparation
tests/                        vitest unit tests; tests/tools/gen-spots.test.ts regenerates enemy spots
```

React never drives the frame loop. `GameEngine` runs its own `requestAnimationFrame` loop: mouse look is applied first for latency, then fixed 120 Hz simulation substeps (player, weapons, bots), then render. React receives throttled HUD snapshots at about 12 Hz plus discrete events (kill feed, status, session end). The crosshair, hit markers and damage-direction arcs are drawn every frame onto a 2D overlay canvas by the engine.

## Phase report: MVP (Phases 1–3, plus the first slice of 4–6)

### Implemented and verified working

Each item below was verified by the automated tests in this repo.

**Movement**
- First-person movement with WASD, walk (Shift), crouch (Ctrl or C) and jump. Running speed is 5.85 m/s (raised from 5.4 m/s); walking and crouching scale from it.
- Accelerate and decelerate model with a fast counter-strafe stop. Stopping from full speed to accurate speed takes under 80 ms (unit test).
- Mouse look on Pointer Lock with raw input.
- Valorant sensitivity scale: 1000 counts at 0.4 sensitivity rotates exactly 28° (e2e).
- Horizontal, vertical and ADS multipliers, plus invert Y.
- AABB collision with wall sliding, 0.4 m step-up, stair snapping and a ceiling check before standing up.

**Maps**
- Eight original maps, each with its own layout, palette, callouts and 3–5 practice locations, plus attack and defend spawns for each location. Maps are built on a grid of 1.5 m cells (`CELL` in `src/game/maps/GridMap.ts`, previously 2 m), so every room, corridor and gap between cover is 25% smaller than the original layouts while the layouts and all heights stay the same. Vellora's hand-placed positions keep their distance to the wall or crate they hug when the cell size changes.

| Map | Inspired by | Practice locations |
|---|---|---|
| Vellora | Ascent | A Main, Mid, B Main |
| Dunehold | Bind | A Short (via Showers), A Long, Hookah (door + window), B Long |
| Sanctum | Haven | A Long, A Short, Mid, Garage, C Long (three sites) |
| Kitsune | Split | A Main (ramps to a raised site under A Heaven), Mid (raised Mid Top), B Main (under B Heaven) |
| Tamarind | Lotus | A Main, B Main, C Main over the C Mound (three sites) |
| Permafrost | Icebox | A Main, Mid (Boiler), B Main into container mazes |
| Coralis | Breeze | A Main into a huge open site, Mid, B Main through the B Elbow |
| Goldline | Sunset | A Main via the A Elbow, Mid (Market/Courtyard), B Main |

- Vellora's enemy positions were placed by hand. On the other seven maps they are generated by `src/game/maps/spotFinder.ts`. It scans every cover face and keeps positions where a bot is fully hidden, becomes visible after a short strafe, and stands in front of the player. Positions that work from every spawn of a side rank first.
- Long, bare corridors are dressed when the map is built (`dressMap` in `src/game/maps/MapData.ts`, all deterministic):
  - Wall tops vary between 6, 7.2 and 8.4 m in 4×4-cell blocks, so skylines step instead of forming one flat canyon.
  - Corridors at least 9 cells long and up to 4 wide get archways (a lintel from 3.6 m up) every 5 cells and low crates against alternating walls every 7 cells. Both are real geometry: they block bullets, sight and movement. Nothing is placed within 2.5 m of a spawn or 1.6 m of a bot's peek line.
  - Walls facing walkable floor get visual-only facade detail (pilasters, framed doors with a step and lamp, windows with sills, wall lamps). It sits within 12 cm of the wall and has no collision.
- After changing a map's geometry or spawns, regenerate with `GEN_SPOTS=1 npx vitest run tests/tools/gen-spots.test.ts`. The output goes to `src/game/maps/generated/*.json`.
- `npm test` checks every map:
  - The border is closed.
  - Every spawn is in free space and standing on the ground.
  - Every spawn has at least 3 peekable enemy positions.
  - Every callout can be reached by navigation.

**Weapons**
- Vandal and Phantom (primaries), Classic and Sheriff (sidearms).
- Each weapon has its own fire rate, magazine, reload, damage by range, first-shot accuracy, spray-spread growth, movement and air inaccuracy, and a hand-authored recoil pattern with recovery.
- Headshots, body shots and leg shots are separate hitboxes that follow crouch.
- ADS with 1.25× zoom on rifles and the Sheriff. The Classic right-click fires a 3-round burst.
- Reload with sound cues (or one recorded reload file per gun), auto-reload when the magazine is empty, weapon switching with equip time (1 / 2, or the mouse wheel to swap; one swap per wheel notch). The reload animation and its sound cues run faster than the reload itself (55% of the reload time, at most 1.3 s); the gun then waits, ready, until the reload completes, so reload times are unchanged.
- Weapon skins: the Vandal (Gaia), Phantom (Reaver) and Sheriff (Arcane) use GLB models from `public/models/weapons`, placed from measured grip, handguard, muzzle and sight points so the hands, muzzle flash, tracers and aim-down-sights line up. The Vandal's magazine drops on reload and the Sheriff's front assembly spins after each shot. Sage bots carry the Vandal skin. Settings → Graphics → Gun models switches back to the simple guns; the Classic has no skin.
- First-person arms (Settings → Graphics → First-person arms):
  - **Animated** (default): the "M4 - FPS Weapon Animations Pack (v.1)" by BarcodeGames (CC BY 4.0, `public/models/fp-arms-anim.glb`, prepared by `scripts/prepare-fp-arms.mjs`), a rigged pair of gloved forearms with Draw, Fire, Reload and Reload_Empty animations. `src/game/weapons/AnimatedArms.ts` evaluates the clips from game state every frame: Draw follows the equip timer, Fire restarts on each shot, Reload (or Reload_Empty when the magazine was empty) follows the reload, played up to 2.2× faster than authored and finishing at 80% of the reload time, and the first Fire frame is the idle pose. The pack's rifle meshes are removed and the game's gun rides the pack's weapon joint, its grip on the M4's grip and pitched a few degrees so its handguard meets the left hand. The gun's magazine follows the pack's magazine joints, so the left hand pulls the old one and seats the new one (the Vandal skin and the simple guns have a separate magazine; the Phantom and Sheriff skins don't). The rig is raised and turned right about its spine so the gun sits lower right in this game's wide field of view, then turned about the gun so the barrel runs parallel to the view and points at the crosshair; aiming down sights moves the whole rig to centre the sights. Pistols have no clips in the pack: the pistol is placed as before, the right hand takes the same hold on its grip that the idle pose has on the M4, and the left arm is solved with two-bone IK to cup it. Synthesized reload cues follow the reload clip.
  - **Rigged arms**: the "First-Person Arm & Hand - Fingerless Gloves" model (`public/models/fp-arms.glb`, by Exactly, CC BY 4.0). The file has no skeleton, so `src/game/weapons/ArmModel.ts` cuts out its two arms at load and skins them in code: two forearm bones (so the forearm can stretch), the hand, and three bones for each finger and the thumb, with weights from each vertex's distance to the bone segments. Each frame two-bone IK puts the right palm against the grip and the left palm flat against the underside of the handguard (measured from each gun's own mesh when it's built, so it fits skins and simple guns alike), or cups the right hand on pistols. The hands then turn to wrap the gun: the left fingers curl up the handguard's right side with the thumb along its left side. The model has no upper arm, so the forearm is laid along the IK forearm and stretched (up to 1.85×) only as far as needed to keep its cut-off elbow end outside the screen.
  - Without either file (and in the single-file build) the same posing drives built-in arms made from simple shapes; **Simple hands** switches to the old block hands.
- Muzzle flash with a light, tracers (the Phantom is suppressed and has none), wall decals, spark and hit particles, and view kick.

**Bots**
- Bots are person-sized (1.8 m, the same as the player). One constant (`BOT_SCALE` in `src/game/bots/perception/visibility.ts`) scales the model, hitboxes (head, body, legs), collision size, eye height and the visibility checks together; the player's own hitboxes stay person-sized. Enemy hiding spots are generated for that size, so regenerate them after changing it.
- Stationary angle holding, jiggle peek, shoulder peek (bait), wide swing (backs up, then sprints wide), crouch spray (with recoil compensation), counter-strafe ADAD, and repositioning to another free spot.
- Perception uses a ~130° field of view with multi-point raycast line of sight, so bots can't see or shoot through walls.
- Reaction delay, an aim error that converges over time, and a head-or-body aim choice.
- Bots stop before shooting (counter-strafe discipline) and pause between bursts so recoil resets.
- Deathmatch AI: patrols or hunts the player, hears gunfire and footsteps, chases the last known position, takes cover when low on health and re-peeks. Navigation is grid A*.
- Bots are drawn with a rigged agent model (Sage). It has no animations, so it is posed in code every frame: the pelvis drops for crouching, legs use two-bone IK to keep feet planted or step along the movement direction, the spine and head follow the aim pitch, and both hands are solved onto the rifle. The pose only re-solves when its inputs change, off-screen bots are skipped and far ones update at a third of the rate. The model is scaled so its head sits inside the head hitbox (`debug.hitboxes(true)` shows them). Settings → Graphics → Bot model switches back to the blocky dummy.
- Difficulty presets (Easy, Normal, Hard, Radiant) plus custom sliders for reaction time, accuracy, peek frequency, peek duration, speed, aggression, burst length and crouch frequency.

**Practice modes**
- **Angle Holding**: behaviour can be selected, and escapes are penalised.
- **Jiggle Peek Training**: jiggles, shoulder baits and commits. Wasted bait shots are tracked.
- **Basic Deathmatch**: up to 10 bots with respawns.

**Analytics**
- Shots, hits, headshots, body shots, leg shots and accuracy.
- Reaction time (from the bot appearing on screen to your first hit) and time to kill.
- First-shot, spray and moving-shot accuracy.
- Kills, deaths, damage dealt and taken, escapes and bait shots, plus a per-weapon breakdown and score.
- A session report at the end of each session. History persists in localStorage.
- Statistics page with daily and weekly charts, per-mode and per-weapon tables, and expandable past reports.

**Settings and UI**
- Sensitivity page: DPI, eDPI, cm/360°, conversion from other games, and a live turn test.
- Crosshair editor: colours plus custom hex, outlines, centre dot, inner and outer lines, error multipliers, static or dynamic. Includes a live and 4× preview, presets, and import/export codes plus a JSON download.
- Graphics presets (Low, Medium, High). Each one sets shadows, resolution scale, FXAA and the level of effects.
- Audio volumes, HUD toggles, and an FPS counter with performance metrics.
- Minimap (top left, on by default): the map turns so your facing is up, with site letters and your view cone. Enemies within 30 m are always shown, even behind walls, as a training aid; ones you can actually see are drawn larger and brighter. Settings → HUD has the toggle and the range (0–60 m, 0 = never show enemies). A dashed ring marks the range.
- Kill-streak sounds: kills 1–5 in a row each play their own rising chime (the 5th repeats; dying resets the streak). Footsteps for you and the bots use four takes with slight pitch variation.

**Robustness**
- The game pauses on Esc, pointer-lock loss, window blur or the tab being hidden.
- Re-lock refusals are handled. Pointer lock is requested before fullscreen, because entering fullscreen uses up the click's user activation and the browser then refuses the lock. If the browser still refuses in a normal tab, the game stays paused and asks for another click; free-cursor aiming is only used inside embedded frames or when you choose it.
- WebGL context loss is caught.
- One Babylon engine is shared by all sessions and only one session can own it at a time. A session can be disposed while it is still loading, so React StrictMode's double mount in `npm run dev` no longer builds two engines on the same WebGL context, which used to double the loading time and corrupt rendering. Compiled shaders are kept (`Effect.PersistentMode`), so only the first session compiles them.
- Bots never use a spot whose peek line passes within 6 m of the player's spawn. Spots are shared by all spawns of a side, so a spot generated for one spawn could otherwise sit next to another.
- A clear message shows when WebGL is unavailable.
- Audio starts on the first click.
- Fullscreen with Keyboard Lock stops Ctrl+W from closing the tab while you crouch-walk.

### Partially done

- **WebGPU** is attempted only when you choose it in Settings, with an automatic fallback to WebGL 2. It hasn't been tested on GPU hardware.
- **Navigation** is grid A*, not a Recast navmesh. It's reliable on this grid-built map, but it isn't Recast.
- **The scoped sensitivity multiplier** is stored but has no effect yet, because there's no sniper rifle.
- **Statistics** live in localStorage (capped at 300 sessions), not IndexedDB.

### Not built yet (roadmap)

- **Map mechanics**: teleporters (Bind), ropes (Split), ziplines (Icebox) and rotating doors (Lotus). The layouts are built, but these mechanics aren't.
- **Weapons**: Ghost, Spectre, Operator and Guardian.
- **Practice modes**: Spray Control and Spray Transfer (with an impact wall and reference overlay), Counter-Strafe and Flick training. Wide-swing practice is available today through Angle Holding with the "Wide Swing" behaviour.
- **Assets**: a Classic skin, more agent models, and real animation clips instead of code posing (bots and first-person arms are both posed in code).
- **Sounds**: no recorded footsteps, reloads or kill-streak sounds are included. The slots exist (see `public/sounds/README.md`); add recordings you have the rights to.

### Known issues and limits

- Animated arms: the pack has no aim-down-sights, walking or pistol animations. Aiming moves the whole rig, and pistols are held by IK from the rifle idle pose, so pistol reloads only dip the gun and the hands don't animate. Rifle reload animations were authored for an M4, so on the Phantom and Sheriff skins (no separate magazine) the left hand mimes the magazine change. The Rigged and built-in arms are solved fresh each frame, not animated. The arm model's joint positions were measured on that one file, so a different arm model won't fit (the game checks the vertex count and falls back to the built-in arms). The forearm's skin texture is visibly stretched when the gun sits far forward. The Phantom and Sheriff skins have no separate magazine, so their reload only dips the gun.
- The minimap doesn't show height: enemies on a raised floor or below you look the same.
- Bots all use a Vandal.
- Bots don't fight each other in Deathmatch.
- Bots have no ragdoll; they fall over with a simple tilt. The agent model's cloth, hair and fingers don't move (those joints were merged to keep posing cheap).
- The agent model isn't part of the single-file build, which always uses the training dummies. It adds about 1.4 MB and roughly 0.4 s to the first session's loading.
- Real-GPU frame rate hasn't been measured; the automated runs use software rendering (SwiftShader, ~10 FPS). Expect to tune shadows and effects on low-end machines with the Low preset.
- If the page is embedded in a sandboxed iframe, Pointer Lock may be blocked. The game then falls back to free-mouse aiming and shows a notice. Open it in its own tab for proper aiming.
- Firefox doesn't support raw (unadjusted) pointer movement, so OS acceleration may apply.
