# Domino Sky — disruption simulator

Close an airport and watch the delay spread through aircraft rotations, passenger connections and crew duty limits — then let an **AI dispatcher** recommend a recovery, with a before/after whose every number is audited against a deterministic simulation.

## For judges — the brief mapped to the app (about one minute)

Open the page and press **▶ 60-second guided demo** (or add `?demo` to the URL). It closes Mumbai for 90 minutes, fast-forwards six hours, shows the cascade, asks the dispatcher what to do, applies its recommendation and replays the day. Everything below can also be done by hand.

| The brief asks for | Where to find it |
|---|---|
| Close any airport for a chosen time | **Scenario tab → “Close an airport”** (airport, start time, duration). Or click an airport on the map → 🚫 Close. Any problem can also be planted anywhere on the map. |
| Watch delay spread across the network | The map (airports and aircraft turn amber/red), the **Rotation schedule** (each aircraft’s chain of flights, scheduled vs actual), the clock and scrubber. |
| Which flights are late, and why | **Flight board** (a *Cause* column per flight), **Where to fix** (every delay traced to its root cause: direct vs knock-on), **Cascade** (the domino chain of one aircraft), and *AI Dispatcher → “Why is X late?”*. |
| How many passengers are stranded | The **Stranded** and **Missed conn.** tiles, the **Passengers** tab, and every dispatcher message. |
| Crews pushed past legal duty hours | The **Crews** tab: each crew’s duty window, projected finish, margin and flights lost. |
| An AI dispatcher recommends recovery actions (cancel a flight, swap in a spare…) | **AI Dispatcher → “What should I do?”** It tests every measure — spare-aircraft swap, rotation cancel, ground-delay program, connection holds, fast turns, rebooking — and recommends the best. |
| Show the result before and after | The recommendation card’s **whole-day before / after table**; **Apply** re-simulates and the dispatcher restates the exact result; the chart overlays *Your plan* on *No action*. |
| All delay and passenger calculations from deterministic code | `js/engine.js` — a seeded discrete-event simulation. Same inputs, same output. On the organisers’ file, a clear day reproduces the published timetable exactly. |
| The AI explains and recommends; every number it states must match the app | See below. |

### How “every number must match” is enforced

1. **The engine computes; nothing else does.** Delays, stranded passengers, crew margins and each recommendation’s before/after all come from `DS.simulate` and its helpers. A recommendation is only ever an action the engine has already simulated.
2. **The narrator only quotes.** `js/dispatcher.js` writes plain English, but every figure is pulled from the engine through a ledger (hover any bold number to see its source key). It never does arithmetic of its own.
3. **An independent audit re-reads the finished text.** It extracts every number and clock time and checks each against the engine’s own output at the precision shown. The badge under each message reads *“✓ 17 numbers checked — all match the simulator”*, or lists what could not be verified. The audit has already caught real slips during development (a figure the narrator used but had not registered).
4. **Optional Claude mode** (AI Dispatcher → “Use Claude instead”): with your own API key, Claude gets read-only tools backed by the engine and must quote their results. Its answer goes through the same audit, and any figure the tools did not return is **highlighted in red**. The key stays in the tab’s memory; nothing is sent unless you press *Ask Claude*.

Verify it yourself: `node test/engine.test.js` runs 48 dispatcher narrations across six clock times and every question type (≈530 numbers audited), proves a changed number or an invented clock time is flagged, and runs the Claude tool loop against a scripted model that tells the truth once and invents numbers once.

### Honest limits
- The built-in dispatcher is a **deterministic narrator, not an LLM**; that is what makes its numbers provably right. Claude mode is optional and its fluency is the model’s, its numbers are audited.
- The audit proves numbers agree with the engine, not that advice is wise; small integers can coincide with an unrelated engine value, so the check is strongest on larger figures and times.
- Model simplifications: one crew flies one aircraft’s chain, runway capacity is a rolling hourly rate, passengers are modelled as connection groups plus local passengers. All are visible in `js/engine.js`.
- **Data:** the default network is the organisers’ `data/flight_network.json`. The India-wide and Worldwide networks are larger *synthetic* examples on a real map. **⬆ Import data** accepts other schedules (CSV/JSON).


- **Two networks** (header dropdown): *India domestic* (18 airports, ~400 flights, times in IST) and *Worldwide* (68 airports, ~860 flights incl. long-haul widebodies, times in UTC).
- **Real map**: Natural Earth 1:50m coastlines, borders and country names (bundled in `js/world-topo.js`, works offline), Web-Mercator with world wrap, great-circle routes, a live day/night terminator, airliner sprites with shadows and contrails.
- **Light / dark theme** toggle (top right); your choice is remembered.

**Run:** double-click `index.html`, or `node serve.js` and open http://localhost:5173. No build step, no dependencies.
**Test the engine:** `node test/engine.test.js`

## The six evaluation parameters — where the evidence is

| Parameter | What was done | How to verify |
|---|---|---|
| **Code quality** | Zero runtime dependencies. One responsibility per file, no file mixes simulation, audit and drawing (see **Project structure**). ESLint clean, Prettier-formatted, EditorConfig, `npm run check` runs lint + format + tests. Comments explain *why*; a dead-code scan is clean. | `npm run check`; read `js/` — the engine and dispatcher have no DOM access. |
| **Security** | Strict Content-Security-Policy (no inline or `eval` scripts; network only to itself and `api.anthropic.com`), referrer suppressed. Imported identifiers and names are validated and hostile files rejected (e.g. `<img onerror=…>` as a flight number); size caps. The optional API key lives in tab memory only, behind an explicit consent box, and travels *only* to `api.anthropic.com` through a first-party `fetch` — deliberately **not** a CDN-loaded SDK, so no third-party code ever sees it. The dev server refuses dotfiles. | `node test/security.test.js` (38 checks) and the *Security* group in `test/browser.html`. |
| **Efficiency** | Measured on the organisers’ file: page ready in ~150 ms (everything loaded in ~320 ms, 13 requests, ~270 KB of app code + 739 KB of map data, scripts deferred); a full-day re-simulation takes **0.3 ms**; testing *every* recovery measure and ranking them takes **~5 ms**; an 860-flight worldwide day simulates in ~4 ms. The static map layer is cached and redrawn only when the view changes; the clock advances by real time, so playback is correct at any frame rate. | The *Robustness* group in `test/browser.html` asserts these budgets. |
| **Testing** | Four Node suites run by `npm test` — engine invariants (no teleporting aircraft, no early departures, deterministic), organiser-dataset conformance (a clear day reproduces the timetable exactly), importer, dispatcher (48 narrations / ~540 numbers audited, tampering and invented figures flagged, Claude tool loop against a scripted model), security (38 checks) and contrast. A deploy-and-wiring suite (127 checks): every file the page loads exists, `dist/` matches the source, the 3D globe keeps its terrain and keyboard controls, `vendor/` is revalidated, every button action has a handler, and the only outside host is the Claude API. Plus a 44-check end-to-end UI page and ESLint (`npm run lint`, run on demand through `npx`, nothing added to the dependencies). | `npm test`; `npm run lint`; open `/test/browser.html` (serve with `npm start`). |
| **Accessibility** | WCAG AA contrast verified for every colour pair in **both** themes by a test (it found and fixed real failures). Landmarks, labelled controls, ARIA tabs with arrow-key navigation, keyboard-operable table rows and cards, skip links, visible focus, `prefers-reduced-motion`, native modal dialogs. The map has a text equivalent: a live situation report plus the flight board and crew tables carry the same information. | `node test/contrast.test.js`; the *Accessibility* group (16 checks) in `test/browser.html`. |
| **Problem-statement alignment** | The brief, point by point, in the table above — on the organisers’ real dataset by default. The briefing even names the signature case: a flight in a city with clear skies, hours after the closure, late only because its aircraft was held earlier. | The *Problem alignment* group in `test/browser.html`; press **▶ 60-second guided demo**. |

## How to play
1. Pick a scenario, or use **Scenario → Close an airport** / plant a problem anywhere on the map. The clock starts shortly before the first problem.
2. Press **Play** (space). Pause any time and open **Recovery** — decisions take effect *from the paused time*; the past never changes.
3. Open **Where to fix**: it traces every delayed flight back to the problem that started it (direct vs knock-on), lists the airports that are bottlenecked right now, and the flights *about to fall next* — each with the best fix, measured by re-simulating the whole day.
4. Compare **Your plan** (cyan) against **No action** (red) on the chart and KPI deltas. Success is measured in operational terms, not money — pick what to optimise: **passenger delay** (pax-hours), **aircraft delay** (aircraft-hours) or **people stranded**. The grade is the share of the weather damage recovered on that objective.
5. Not sure what to do? **Advisor** re-simulates every measure and ranks it on the chosen objective; **Auto-optimise** applies the best ones greedily. Rupee cost is shown only as "resources committed" for reference.

## What is modelled
- **Aircraft rotations** — each aircraft flies a chain of flights and a late arrival delays its next departure after the minimum turnaround (organiser file: 16 aircraft, 70 flights, 2 spares; India network: 102 aircraft, ~400 flights).
- **Problems placed anywhere** — click the map to plant a thunderstorm, cyclone, dust storm, snowstorm, fog, volcanic ash, runway closure or ATC outage; drag to move. Airports inside the circle are closed or throttled by distance from its centre; storm-type cells also force flights crossing them to detour.
- **Runway capacity** per airport. Slots are allocated in time order.
- **Holding / diversion** — inbound aircraft hold up to 40 min, then divert to the nearest open airport and ferry on later.
- **Crew duty limits** — each crew’s window and maximum come from the data on the organisers’ file (14 h on the synthetic networks); a crew that would exceed it cannot fly the leg and the rest of its day is cancelled. Delays >4 h also cancel the rotation.
- **Passengers** — connection groups (organiser file: 21 connections with their own minimum connect times) plus local passengers; missed connections and cancellations are re-booked on later flights with free seats, otherwise stranded overnight.
- **Domino generation** — G0 = hit directly by weather, G1, G2… = each later link in the same aircraft chain.

## Recovery measures
Ground-delay program · hold connections · fast turnarounds · surge operations · spare-aircraft swap · rotation cancel · crew-duty extension · auto-rebooking & care. Each shows a live what-if preview (in passenger-hours, aircraft-hours or people stranded) before you commit.

## Data

**Default network = the organisers' dataset** (`data/flight_network.json`, also embedded as `js/dataset.js` so the page works when opened straight from disk): 16 airports, 70 flights on 16 aircraft, 21 passenger connections (each with its own minimum connect time), 16 crews with explicit duty windows (600 min), 2 spare aircraft with availability times, 30-minute minimum turnaround. Everything in the file is used as given:

| In the file | How the simulator uses it |
|---|---|
| `capacity_per_hour` | at most that many movements in any rolling 60 minutes; weather scales it, a closure sets it to zero |
| `min_turnaround_minutes`, `leg_order` | an aircraft cannot depart until its previous flight has landed and the turnaround has passed |
| `connections[].min_connect_minutes`, `passengers` | a connection is missed when the onward flight leaves less than that after the feeder lands |
| `crews[].duty_start`, `max_duty_mins` | a crew cannot fly a leg that would end after the window closes; the rest of its day is cancelled. Treated as a **legal hard limit**, so "extend crew duty" is never offered for this dataset |
| `spare_aircraft[]` | a spare can take over a late flight and the rest of its rotation (a fresh standby crew), no earlier than `available_from` |

With nothing planted the simulator reproduces the published timetable exactly (checked in `test/engine.test.js`: 0 of 70 flights differ).

**Scenarios** (Mumbai 90 min from 07:30, Mumbai from 14:30, Delhi 2 h from 12:15, Chennai + Kolkata) were chosen by scanning every closure window against this timetable for the one that cascades most; the 07:30 morning bank is where a Mumbai closure hurts, while 10:00 barely touches it.

**Other schedules:** *Import data* (⬆) reads this same JSON format natively, or any CSV/TSV/JSON timetable (column names matched loosely; aircraft rotations inferred if there is no tail column). The *India domestic* and *Worldwide* networks are larger **synthetic** examples generated from a seed (`js/data.js`) on the real map.

Map data: Natural Earth (public domain) via the `world-atlas` package (ISC licence).
Terrain imagery: NASA Visible Earth — *Blue Marble* with ocean-floor shading (dark theme) and a shaded-relief world map (light theme), public-domain NASA imagery distributed in the `three-globe` package (MIT), stored in `assets/` and loaded on demand. The map has a **Terrain / Minimal** switch; Minimal is the flat vector style.

## Honest limits
- Small integers in AI text are checked against everything the engine reported, so a *small* invented number can coincide with a real one by chance; large or unusual figures, and every clock time, are caught reliably.
- Passenger rebooking, diversion and crew behaviour are simplified models (documented in the engine); the dataset has no fare, baggage or fuel data, so none are modelled.

## 3D globe view

Press **3D** (top-right of the map, or the `G` key; `?view=3d` in the URL opens it directly). Everything on the 2D map is in 3D too: airports coloured by delay, closed airports, aircraft flying great-circle arcs at altitude with contrails, storm columns, a live day/night terminator, selection, tooltips, detail cards, and *plant a problem* by clicking the globe. Drag to rotate, scroll to zoom, **Recenter** to return. From the keyboard, focus the globe (Tab) and use the arrow keys to rotate, **+** / **−** to zoom and **Home** to re-centre.

- **Same numbers, different picture.** The globe reads the same state object as the 2D map (`S.res.plan`, `S.weather`, `S.now`), so it can never disagree with the deterministic engine.
- **No assets, no keys, no tile servers.** The Earth texture is generated at runtime from the bundled Natural Earth data, so it works offline.
- **Loaded on demand.** The 3D engine (`vendor/globe3d.js`, ~630 KB, three.js bundled) downloads only when you first press 3D.
- **Safe fallback.** If WebGL is unavailable (some headless or locked-down browsers), the 3D button disables itself with an explanation and the 2D map keeps working.
- **Source:** `src3d/globe3d.js`. Rebuild the bundle with `npm install` then `npm run build:3d`. The built file is committed, so deploying never needs this step.

## Project structure

Plain scripts, loaded in this order by `index.html` (no bundler; it also works opened straight from disk).

| Layer | Files | Responsibility |
|---|---|---|
| Data | `dataset.js`, `data.js`, `import.js`, `validate.js`, `world-topo.js` | The organisers' network, synthetic networks, bring-your-own import with safety checks, map outlines |
| Engine (DOM-free) | `engine.js`, `engine-metrics.js`, `advisor.js` | Deterministic simulation; costs, metrics and standings; recovery options and diagnosis |
| AI dispatcher (DOM-free) | `dispatcher.js`, `dispatcher-audit.js`, `dispatcher-claude.js` | Narrator that only quotes the engine; the auditor that re-checks every number; the optional Claude client |
| Map | `map-geo.js`, `map-style.js`, `map.js` | Projection, outlines and great circles; palettes, terrain and themes; the canvas renderer |
| UI | `ui-core.js`, `ui-left.js`, `ui-right.js`, `ui-bottom.js`, `ui-detail.js`, `ui-events.js`, `ui.js` | State and helpers, the three panels, the map card, input handling, boot and the public API |
| UI features | `ui-dispatcher.js`, `ui-crews.js`, `ui-airport.js`, `ui-demo.js`, `ui-a11y.js`, `tracker.js`, `view3d.js` | Plug in through `window.DominoSky.HOOKS`: chat, crews tab, close-an-airport, guided demo, accessibility, tracker chrome, 3D globe |

The UI files share one small registry (`DS.ui`) instead of one giant closure. Anything that must run in Node (engine, dispatcher, import) never touches the DOM, which is what lets the test suites load it directly.

## Deploy for free (static site — no server, no environment variables)

The whole app is plain files. `npm run build` (or `node scripts/build-static.js`; no dependencies) copies exactly what a browser needs into `dist/` (~1.7 MB) and checks that every referenced file exists. A ready-made `dist/` is committed, so any host works even with no build step.

| Host | How |
|---|---|
| **Netlify** | Drag the `dist/` folder onto app.netlify.com/drop — or connect the repo (`netlify.toml` sets build command and publish dir). |
| **Vercel** | Import the repo; `vercel.json` sets framework "Other", build command and output directory `dist`. (Hobby plan is for non-commercial use.) |
| **Firebase Hosting** | `firebase init hosting` → keep `firebase.json` (public dir `dist`, runs the build before deploy) → `firebase deploy`. |
| **Render** | New → Blueprint from the repo (`render.yaml`), or a Static Site with build command `node scripts/build-static.js` and publish directory `dist`. |
| **Supabase** | Not a web host; it is only needed if you later add saved data or user accounts. |

Notes: all asset paths are relative, so the site also works from a sub-folder or from a double-clicked `index.html`. Nothing in the front end holds a secret. The optional "ask Claude" mode in the AI Dispatcher uses a key the user pastes into the page, which stays in the tab's memory. Free-tier limits change, so check each host's current limits before launch.
