# tcs: No Man's Land, a Trench Crusade simulator

A top-down 2D skirmish simulator for Trench Crusade. It plays the one-off scenario **Claim No Man's Land** with warbands of 900 ducats and 8 Glory.

- 30 preset warbands across all seven factions, including the variants from the newer standalone PDFs. You can also build and save your own list.
- Play either side yourself or let the AI play, at any speed from 0.5× to 8×.
- 3D dice are rolled onto the table for every roll. Glowing blood, blessing and infection tokens circle the models, and shooting and melee attacks are animated.
- A battle log explains every move, the AI's reasoning and every roll with its modifiers.

## Run it

It is a static page with no build step. Serve the folder and open it:

```
python -m http.server 8000
```

Then go to http://localhost:8000.

## Files

| Path | What it is |
|---|---|
| `index.html` | page, layout and styles |
| `core.js` | core battlekit and mercenaries |
| `data/*.json` | one file per faction: variants, models, armoury, unique kit and preset lists (rules text paraphrased) |
| `factions.js` | bundle of `data/*.json`, made by `node tools/build.js` |
| `engine.js` | rules engine (rolls, injuries, blood markers, line of sight, cover, pathing, morale, VP) and the AI |
| `ui.js` | board renderer, dice, animations, battle log, hand controls, setup screen and list builder |
| `tools/headless.js` | runs AI-vs-AI games in Node to find engine errors: `node tools/headless.js 30` |

After editing anything in `data/`, run `node tools/build.js`.

## Known limits

- Abilities whose effects don't fit the engine's simple patterns are shown as text only (for example Bodyguard, and the abilities that remove injury dice).
- Blood and blessing markers are spent automatically, even when you play a side yourself.
- No preset uses the Papal States variant: in one-off games it trades 200 ducats for 11 Glory, which breaks the 900 / 8 budget.

Trench Crusade is the property of its creators. This is an unofficial fan tool.
