# Highway Rush 3D 🏎️

Endless 3D highway racing game (Three.js, browser me chalta hai).

## Features
- **Realistic 3D Supercar**: High-detail Ferrari 458 Italia 3D model (Sketchfab / Three.js) with automotive clearcoat paint customization, metallic alloy rims, rubber tires, Brembo calipers, xenon headlights, glowing brake lights, turning interior steering wheel, and baked ambient occlusion contact shadow
- **Realistic PBR Highway**: High-resolution procedural asphalt with aggregate stones, bump map for physical micro-depth, roughness map capturing specular sky reflections on polished tire tracks, thermoplastic painted lane dashes and edge lines, grooved shoulder rumble strips, 3D bevelled concrete curbs, 3D corrugated W-beam guard rails, and New Jersey concrete median barrier
- **Realistic Roadside Assets**: Compound 5-tier layered pine trees with natural foliage silhouettes, modern cobra-head LED highway streetlights, overhead steel box-truss gantry signs with blinking amber warning beacons, and weighted high-visibility traffic cones and hazard barricades
- **Varied Realistic Traffic**: Sports coupes, luxury executive sedans, modern SUVs, heavy-duty semi-trucks with corrugated trailers and DOT-C2 reflective tape, and touring coach buses
- Unlimited procedurally generated curvy + hilly highway (superwide 8-lane road, 4 lanes each way, mountains, sunset sky with HDR environment lighting)
- Challenges: roadworks barriers + cones, near-miss bonus, score multiplier, health/damage, wrong-way warning, centre-median rumble (grinding the concrete divider costs health)
- Landmarks: spinning wind turbines on the hills + glowing gantry arches with blinking lamps
- Rewarded ad revive: watch a short ad after crashing for 1 extra life (once per run)
- Boost pads painted on the tarmac: drive over for instant nitro + a speed kick
- Nitro boost, handbrake drift, tyre smoke, sparks, crash physics, camera shake, 6 camera views (chase, long shot, hood, cinematic, sky cam, rear view)
- Sound: RPM-based V8 engine with gear shifts, tyre screech, wind, guard-rail scrape, nitro, horn, other cars honking, crash, whoosh, background music
- HUD: speedometer/tachometer, gear, minimap, health & nitro bars, best score saved
- 3 difficulties, touch controls for mobile (gas/brake/nitro/steer + camera & horn buttons)
- Fail-safe startup: procedural road/car assets launch immediately; grass, HDR lighting and music enhance the race in the background when available
- CrazyGames SDK integration (ads only): interstitials between completed runs + optional rewarded "second chance" revive

## CrazyGames integration (ads only)

`js/ads.js` (`CrazyGamesAdManager`) wraps the official CrazyGames HTML5 SDK (v3, loaded once in `index.html`). It is used **only for advertising** — no accounts, cloud saves, leaderboards, or purchases.

- Interstitials (`midgame`) fire only at natural breaks: after a run ends, when starting the next race — never during driving, never at first launch (60s session grace + CrazyGames' ~3-minute ad cooldown is honoured client-side too)
- Rewarded ads power the optional **WATCH AD · SECOND CHANCE** revive on the game-over screen (once per run). The reward is granted strictly in the SDK's `adFinished` callback — skipping/failing the ad grants nothing
- Game audio is muted in `adStarted` and restored in `adFinished`/`adError`, per CrazyGames requirements; `gameplayStart()`/`gameplayStop()` bracket active gameplay
- Every SDK call is guarded: if the script is blocked, the CDN is unreachable, or `SDK.init()` fails, the game runs exactly as before with ads disabled (adblock users never see the revive button)


## Run
```
python3 -m http.server 8080
```
Open http://localhost:8080

## Controls
W/↑ gas · S/↓ brake/reverse · A/D steer · SPACE handbrake · SHIFT nitro · H horn · C camera · M music · P pause

## Credits
- Grass texture, HDR environment and Three.js — from the [three.js](https://github.com/mrdoob/three.js) repository examples (MIT)
- Music: "Bad Cat [Master Version]" by Skullbeatz — Newgrounds, CC BY-NC-SA (see `assets/sounds/LICENSE-music.txt`)
- Engine/effects sounds are synthesized in real time with the Web Audio API
