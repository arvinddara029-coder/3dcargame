# Highway Rush 3D 🏎️

Endless 3D highway racing game (Three.js, browser me chalta hai).

## Features
- Unlimited procedurally generated curvy + hilly highway (4 lanes, guard rails, street lamps, trees, mountains, sunset sky)
- Realistic Ferrari 458 GLTF model (paint colour choose karo)
- Oncoming traffic (left lanes) + same-direction traffic, trucks & buses, lane changes, AI braking
- Challenges: roadworks barriers + cones, near-miss bonus, score multiplier, health/damage, wrong-way warning
- Nitro boost, handbrake drift, tyre smoke, sparks, crash physics, camera shake, 3 camera views
- Sound: RPM-based V8 engine with gear shifts, tyre screech, wind, guard-rail scrape, nitro, horn, other cars honking, crash, whoosh, background music
- HUD: speedometer/tachometer, gear, minimap, health & nitro bars, best score saved
- 3 difficulties, touch controls for mobile

## Run
```
python3 -m http.server 8080
```
Open http://localhost:8080

## Controls
W/↑ gas · S/↓ brake/reverse · A/D steer · SPACE handbrake · SHIFT nitro · H horn · C camera · M music · P pause

## Credits
- Ferrari 458 model, grass texture, HDR environment, Three.js — from the [three.js](https://github.com/mrdoob/three.js) repository examples (MIT)
- Music: "Bad Cat [Master Version]" by Skullbeatz — Newgrounds, CC BY-NC-SA (see `assets/sounds/LICENSE-music.txt`)
- Engine/effects sounds are synthesized in real time with the Web Audio API
