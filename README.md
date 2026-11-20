# tcs: No Man's Land, a Trench Crusade simulator

A 3D skirmish simulator for Trench Crusade. Warbands of 900 ducats and 8 Glory fight over a table that is generated for the scenario and the battlefield you pick.

- 30 preset warbands across all seven factions, including the variants from the newer standalone PDFs. You can also build and save your own list.
- Play either side yourself or let the AI play, at any speed from 0.5× to 8×.
- The table is a 3D diorama: sculpted ground, ruins with upper floors, trenches, wire, craters and landmarks, with weather, fog and a sky to match. Drag to orbit, right-drag to pan, wheel to zoom.
- Every model is a miniature built from its faction, name and kit. Glowing blood, blessing and infection tokens circle the models, and shooting, melee, explosions and deaths are animated.
- 3D dice are rolled onto the table beside the model for every roll.
- A battle log explains every move, the AI's reasoning and every roll with its modifiers.

## Scenarios and battlefields

The setup screen has a scenario and a battlefield. The scenario sets the deployment zones and the objectives; the battlefield sets the terrain and the look. The same table seed, scenario and battlefield always give the same table.

| Scenario | Deployment | Objectives |
|---|---|---|
| Claim No Man's Land | 6" strips on opposite edges | five ruins, 2 VP each per turn (the rulebook one-off scenario) |
| Break the Line | 6" strips on opposite edges | three strongpoints on the centre line, 3 VP each per turn |
| The Reliquary | 6" strips on opposite edges | a chapel in the centre worth 4 VP per turn, and two wayside relics worth 2 VP each |
| Crossfire | 12" squares in opposite corners | four ruins worth 2 VP each per turn, around a central relic worth 3 VP |

Only Claim No Man's Land comes from the rulebook. The other three are simulator scenarios that use the same turn sequence, morale and Glorious Deeds.

| Battlefield | Terrain |
|---|---|
| No Man's Land | mud, shell craters, wire, sandbags, wrecked tanks and broken statues |
| The Trench Lines | a zig-zag trench with a sandbag parapet in front of each side, more wire |
| The Shattered City | extra buildings, rubble heaps in place of craters, cobbles |
| The Mouth of Hell | ash, basalt spikes, tar pits, burning fissures in place of wire |
| The Iron Wall Marches | sand, stone-block walls, obelisks |
| The Frozen Front | snow, frozen shell-holes, dead trees |

"Auto" picks a battlefield that suits the scenario, leaning toward the home ground of the two warbands. The rules of each terrain piece are the same on every battlefield: ruins block sight and can be climbed, low walls give cover, craters and rubble are difficult ground, wire and fissures are dangerous, and landmarks block movement and sight.

## Run it

It is a static page with no build step. Serve the folder and open it:

```
python -m http.server 8000
```

Then go to http://localhost:8000. The 3D view needs WebGL 2, and it loads three.js 0.160 from the jsDelivr CDN, so the first load needs an internet connection.

`TC.start({ a, b, ctrl, scenario, field, seed })` in the browser console starts a game directly, with `a` and `b` as preset list ids.

## Files

| Path | What it is |
|---|---|
| `index.html` | page, layout and styles |
| `core.js` | core battlekit and mercenaries |
| `data/*.json` | one file per faction: variants, models, armoury, unique kit and preset lists (rules text paraphrased) |
| `factions.js` | bundle of `data/*.json`, made by `node tools/build.js` |
| `engine.js` | scenarios, battlefields and terrain generation; rules engine (rolls, injuries, blood markers, line of sight, cover, pathing, morale, VP); the AI |
| `ui.js` | game flow, dice labels, battle log, hand controls, setup screen and list builder |
| `view/view.js` | 3D renderer: camera, post-processing, picking, overlays and name plates |
| `view/world.js` | builds the battlefield from the terrain: ground, ruins, trenches, wire, landmarks, sky, weather and light |
| `view/minis.js` | miniatures: figure builder per faction, tokens, movement and death |
| `view/fx.js` | particles and the animations for shots, flame, grenades, explosions, melee, blood and abilities |
| `view/dice.js` | the 3D dice |
| `view/util.js` | shared helpers: seeded random, noise, textures, geometry merging |
| `tools/headless.js` | runs AI-vs-AI games in Node across every scenario and battlefield to find engine errors: `node tools/headless.js 30` |

After editing anything in `data/`, run `node tools/build.js`.

## Known limits

- Abilities whose effects don't fit the engine's simple patterns are shown as text only (for example Bodyguard, and the abilities that remove injury dice).
- Blood and blessing markers are spent automatically, even when you play a side yourself.
- No preset uses the Papal States variant: in one-off games it trades 200 ducats for 11 Glory, which breaks the 900 / 8 budget.
- Trenches are cover only: the parapet works as a low wall, and the sunken floor does not change movement or line of sight.
- The reachable-ground overlay is drawn at ground level, including under an upper floor.

Trench Crusade is the property of its creators. This is an unofficial fan tool.
