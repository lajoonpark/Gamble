# Gamble

A three.js slot machine as a Mac wallpaper. Cause why not.

![The machine, idle](docs/idle.png)

A bright, loud, chrome-and-bulb cabinet floating in a magenta haze. It tilts
with your cursor, pays out in coin fountains, and remembers your money between
reloads. You start with $100 and every pull automatically bets 10% of your
balance — there is nothing to configure.

## Run it

```sh
npm start            # http://127.0.0.1:5173
```

Click the machine, grab the lever, or press `Space` to spin.

| Key | Action |
| --- | --- |
| `Space` / `Enter` / click | Pull the lever |
| `R` | Reset to $100 |
| `H` | Hide the HUD (wallpaper mode) |

`?seed=123` makes the spins deterministic; `?autoplay=1` spins forever.

## The game

- Bet is always 10% of the current balance, deducted on pull, paid back on stop.
- Three of a kind pays a symbol multiple (cherry 3× … seven 106×). Any pair pays 1.2×.
- Measured over all 1728 reel combinations: **96.47% RTP, 52.1% hit rate**.
  Sessions trend down — the median balance falls to ~$6 over a few hundred
  spins — but roughly one run in a hundred peaks above $1,000.
- Two premium symbols on the first two reels make the third reel crawl and glow
  (anticipation), because near-misses are most of the fun.
- Balance, spin count and peak persist in `localStorage`. `Reset` starts a clean run.
- Leave it alone for ~14 seconds and it spins itself, with no effect on your money.
  The first mouse move takes control back immediately.

| ![jackpot](docs/jackpot.png) | ![out of credit](docs/busted.png) |
| --- | --- |
| Triple sevens | Out of credit |

## Layout

```
index.html          page shell, HUD, import map
src/game.js         pure logic + strips + paytable (no three.js, no DOM)
src/machine.js      cabinet, drums, lever, marquee, bulbs, balance panel
src/textures.js     every canvas texture, drawn procedurally
src/effects.js      pooled particle systems, coin fountain, shockwave rings
src/stage.js        renderer, procedural env map, lights, bloom, camera
src/main.js         input, spin sequencing, win tiers, attract mode
vendor/             three.js r170 module build + the addons used
tools/              local server and the checks below
```

The reels are real geometry: `STRIPS` in `src/game.js` is both the RNG source
and the strip the drums render, so what you see is provably what was rolled.

## Checks

```sh
npm run check    # parse every module as an ES module
npm run sim      # exact RTP over all 1728 outcomes + session survival curves
npm start &      # the next two need the server
npm run verify   # boot a browser and confirm reels land on the rolled symbols
npm run e2e      # spin/reset/bust/attract/takeover + a clean console
```

`tools/shot.mjs` grabs a screenshot through CDP for visual review.

## Porting to an actual wallpaper

The web view only needs a surface to draw into. On macOS, the planned shape is
a `.saver` or `WKWebView` host pointing at this directory, with the window at
`NSWindow.Level.desktopIconWindow` and clicks forwarded. Everything that
matters — the demo spin, the tilt, the money — already lives in the page.
