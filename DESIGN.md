# Small Circles: design system

> **North star: "The margin of a sketchbook."**
> Someone taped a photo into a notebook and, with one pen and a few markers, drew the story of that moment around it. Small Circles is that page, drawn for you.

A photograph is the only realistic thing on the page. Everything around it is drawn: ink lines, small doodles, handwritten labels, arrows, and a flat marker colour that never quite lines up with its outline. The page should feel made by a hand, warm, a little imperfect, and personal. It should never feel like software.

---

## 1. Principles

1. **The photo is the moment.** It stays whole, centred and uncovered. Nothing is drawn over it except one piece of tape.
2. **Everything else is ink.** Context is drawn, never pasted: no stock images, no screenshots, no AI art, no emoji.
3. **One pen, a few markers.** Lines are one ink colour. Colour comes only from flat marker fills, at full strength, never a tint or gradient.
4. **Imperfect on purpose, and the same every time.** Every line wobbles, and the wobble is seeded. The same circle always draws the same way, and no two circles draw alike.
5. **Draw, don't load.** Nothing appears with a spinner. It is drawn into place, stroke by stroke, while the page says in handwriting what it's doing.
6. **Few things, well placed.** Three to eight objects around a moment. Empty paper is part of the drawing.
7. **Small type, plain words.** Lowercase, short, human. "evening in paris", not "Location: Paris, France".
8. **The machinery is invisible.** No mention of agents, models, crawls or APIs in the product. It just knows things.

---

## 2. Colour

### Paper and ink

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f3ede2` | The page. Warm, off-white, never pure white |
| `--paper-deep` | `#e9e1d2` | Page edge, pressed areas, the tray under the drop zone |
| `--sheet` | `#fbf8f2` | The photo's print border and the explore card, one step lighter than the page |
| `--ink` | `#1f1c18` | All lines, all handwriting, all text. A warm black, like a fineliner |
| `--ink-soft` | `#6d665c` | Secondary handwriting, pencil notes, dates |
| `--ink-faint` | `rgba(31,28,24,.12)` | The dot grid, pencil guides, placeholder strokes |

### Markers

Six markers, used as **flat fills behind a drawing, offset 2–4px from the outline**, like a riso print slightly out of register. A doodle takes at most one marker. A page uses at most three: the mood picks a family (warm, cool, night) and the seed picks one set of three from it, so two warm circles still don't match.

| Token | Value | Feels like |
|---|---|---|
| `--marker-sun` | `#ffcf3f` | Light, warmth, daytime, gold |
| `--marker-coral` | `#ff6b4a` | People, food, heat, the evening |
| `--marker-sky` | `#7fb4ff` | Water, sky, cool, night, travel |
| `--marker-leaf` | `#6fd08c` | Parks, plants, outdoors, calm |
| `--marker-lilac` | `#b79bff` | Music, dusk, play, night lights |
| `--marker-blush` | `#ff9fc9` | Parties, sweetness, soft days |

### The pop

| Token | Value | Use |
|---|---|---|
| `--pop` | `#ff4f1f` | The one loud colour: the drop target, the drawing cursor, "live", the primary button. Tiny and rare |

**Rules**
- **The marker-offset rule.** Fills never sit exactly inside their outline. Offset them by a seeded `(dx, dy)` of 2–4px so they read as printed, not filled.
- **The three-marker rule.** At most three marker colours on one circle. The renderer picks them from the moment's palette: warm for evening and food, cool for night and water.
- **No tints, no gradients, no glows.** A colour is at full strength or it is paper.

---

## 3. Type

| Role | Face | Setting |
|---|---|---|
| **Title** (the moment's name) | Instrument Serif, italic | 44–72px, line-height 0.95, lowercase |
| **Hand** (labels, notes, narration) | Kalam, 400 / 700 | 15–22px, line-height 1.15, lowercase |
| **UI** (buttons, explore text, forms) | Geist | 14–16px, 400 / 600, sentence case |
| **Small print** (dates, sources, coordinates) | Geist Mono | 11–12px, uppercase allowed, `letter-spacing: .08em` |

- Handwriting is for **anything that reads as a note on the page**: labels, arrows' words, the drawing narration.
- The serif is used **once per page**, for the moment's title.
- The mono is used for facts that are "stamped": the date, coordinates, the source domain.

---

## 4. Shape and depth

- **Paper has sharp corners.** The photo print has 2px corners and a 10px border of `--sheet` on three sides and 28px at the bottom, like an instant print.
- **Chrome is a pill.** Buttons and chips are `border-radius: 999px`, `--ink` background, `--paper` text, with a hard shadow `0 3px 0 rgba(31,28,24,.22)`. Hover lifts 1px, press sinks 1px.
- **The quiet button** is paper with a 1.5px ink outline drawn as an inset shadow.
- **Shadows are contact, not float.** The print casts `0 1px 0 rgba(31,28,24,.18), 0 10px 18px -12px rgba(31,28,24,.35)`. Nothing else casts a shadow except the lifted explore card.
- **Tilt at rest.** The print rests at a seeded −3° to 3°. Doodles rotate within ±12°. Anything picked up (hovered, opened) straightens.
- **Tape, not glue.** One strip of translucent tape holds the print: `rgba(255,236,190,.72)`, 64×18px, rotated, with an ink contact line `0 1px 0 rgba(31,28,24,.08)`.

---

## 5. The circle (the composition)

```
                 [sun] golden hour                      [spark]
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      ~                                           ~
    ~  [coffee] café de flore     [tower] eiffel tower ~
   ~              \                   /              ~
  ~               +-------------------+               ~
  ~ [map] 7th arr.|                   | [cloud] 21°   ~
  ~               |       PHOTO       |               ~
   ~              |                   |              ~
    ~ [calendar]  +-------------------+  [people]   ~
      ~   june 14      paris, evening    two of us ~
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

- **The ring.** One hand-drawn loop, not a perfect circle: two passes of a seeded wobbly ellipse, the second slightly offset, and the ends overlapping where they meet. `stroke-width: 1.6px` in `--ink`.
- **The anchor.** The photo sits at the centre, about 38% of the ring's width, tilted and taped.
- **The title** is written under or over the photo in the serif italic, with the date in mono beneath it.
- **Objects sit on or just inside the ring**, placed by importance:
  - the most important object gets the largest size and the top position that the photo's composition leaves open;
  - lesser objects shrink (from 1.0× to 0.55×) and move further round the ring;
  - objects never overlap the photo, and keep 12px apart.
- **Connections.** An object that points at something *in* the photo gets a hand-drawn arrow that stops 8px short of the print. At most two arrows per circle.
- **Labels** are handwritten next to each object, on the side facing away from the photo, at most three words.
- **Scatter.** One to three tiny marks (a star, a dot cluster, a spark) sit in empty space so the page feels finished. They carry no meaning.

**Every circle is different because:** the seed sets the ring's wobble, the print's tilt, the start angle, the marker palette and each object's rotation. The count, importance, category and time of day decide the rest. A trip spreads wide, a dinner sits close, a concert tilts its objects, a night circle uses sky and ink only.

### 5b. The outer ring: what people added

A circle is a shared thing. What other people add is drawn *outside* the moment's own ring, so the eight-object rule for the moment itself still holds, and the circle visibly grows.

- **Kinds.** A **reaction** is one doodle and one handwritten word. A **note** is a taped `--sheet` slip in handwriting. A **memory** is the same slip with a `--marker-coral` edge. A **photo** is a tiny instant print with a caption on its chin. Each carries the contributor's name in mono: `— amber fox`.
- **Seats.** Twelve seats on a larger, fainter ring, filled in a spread-out order from a seeded start, so the ring fills evenly and nothing already there moves when something new lands.
- **Connection.** A faint hand-drawn line runs in from each one to the moment's own ring.
- **Growth.** The page frame eases outward (about a second) to hold whatever is there. From four additions on, the outer ring itself is drawn, dashed and faint.
- **Arrival.** Something added while you're looking draws itself in and lands with the print's `land` motion. While Small Circles is still reading it, only its author sees it, at half ink, marked "reading…".

---

## 6. The illustration vocabulary

Every concept maps to a **primitive**: a small drawing made of 1–6 strokes plus an optional marker fill, designed on a 100×100 box.

- Strokes are generated, never static SVG. Each one is resampled into points, jittered by the seed, and drawn as a smooth path. Roughness goes from 0 (steady hand) to 1 (quick sketch).
- Stroke width is 1.4–2.2px at 1× scale and does not scale with the object. Big drawings are drawn in more detail, not with thicker pens.
- Each primitive lists its **marker** (which shape gets the fill) and its **default colour**.
- Primitives are grouped as follows. Each is drawable at any scale, rotation and roughness.

| Group | Primitives |
|---|---|
| Place | pin, map, landmark_tower, building, house, bridge, mountain, city |
| Nature | sun, moon, cloud, rain, snow, wave, tree, flower, leaf |
| Time | clock, calendar, star |
| Food & drink | coffee, wine, plate, cake, bowl |
| Travel | plane, car, train, bike, ticket, suitcase, boat |
| People | person, people, heart, hand |
| Things | camera, music, book, gift, phone, lamp |
| Marks | arrow, spark, dots, underline, scribble |

Adding a primitive means adding one entry to the registry. Nothing else changes.

---

## 7. Motion: drawing into existence

| Token | Value | Job |
|---|---|---|
| `--ease-ink` | `cubic-bezier(0.45, 0.05, 0.2, 1)` | A pen stroke: slow start, confident middle, soft stop |
| `--ease-land` | `cubic-bezier(0.2, 0.9, 0.3, 1.15)` | Something placed on the page (slight overshoot) |
| `--ease-lift` | `cubic-bezier(0.16, 1, 0.3, 1)` | Hover, press, open, close. Never overshoots |
| `--dur-tap` | 120ms | Press |
| `--dur-hover` | 180ms | Hover, focus |
| `--dur-stroke` | 420–900ms | One stroke, scaled by its length |
| `--dur-object` | 1100ms | A whole doodle, strokes in sequence |
| `--dur-page` | 600ms | Opening or closing a circle |

**The generation sequence**
1. The photo **drops** onto the page (scale 1.06 to 1, land ease) and the tape presses on.
2. The **ring draws itself** in one continuous stroke, about 1.4s.
3. A pen cursor (a small `--pop` dot) moves around the page. As each step finishes, a **handwritten note** writes itself in the margin: "reading the photo…", "june 14, just before sunset", "this is paris".
4. Each object **draws on**: strokes in order via `stroke-dashoffset`, then its marker fill fades in offset (200ms), then its label writes left to right (`clip-path`).
5. Objects arrive **as the backend finds them**, not on a timer. Nothing is faked.
6. When finished, the narration notes fade to pencil (`--ink-soft`) and the pen cursor lifts off.

**Resting life.** Nothing loops forever except one detail per circle: the sun's rays turn slowly, a cloud drifts 4px, or the stars twinkle. Under `prefers-reduced-motion` every drawing appears complete.

---

## 8. Interaction

- **Hover an object:** it straightens, lifts 2px, and its label underlines itself with a quick hand-drawn line.
- **Open an object:** an explore card (a `--sheet` index card, tilted 1°, with the contact shadow) slides in beside the circle with:
  - the object redrawn larger;
  - one or two sentences of context;
  - a small drawn map when a place is involved;
  - the source as a mono domain link.
  - The rest of the circle dims to 40% ink.
- **The drop zone** is the landing page: a dashed hand-drawn rectangle on paper with "give small circles a moment". Dragging a photo over it turns the dashes `--pop` and makes them march.

---

## 9. Voice

- **Lowercase and warm:** "evening in paris", "two of you", "it rained earlier", "just around the corner".
- **Say what it noticed, not what it did:** "the light says it's about 8pm", not "EXIF timestamp parsed".
- **Be honest when it can't tell:** "no location in this one. looks like a café though."
- The **`·`** middle dot separates facts.

---

## 10. Don'ts

- No emoji, no stock icons, no clip art. Everything drawn is drawn by our renderer.
- No AI-generated images anywhere.
- No gradients, glows, glass, or blurred shadows other than the print's contact shadow.
- No cards-in-a-grid dashboard. Home is a table of circles, not a feed.
- Nothing drawn on top of the photo except tape.
- No more than 8 objects, 2 arrows and 3 markers on one circle's own ring. What people add lives on the outer ring (§5b), newest 12.
- No likes, follower counts or public tallies. The only numbers ("seen by 4 · 2 added") are shown to the moment's author. Visitors only ever see an invitation: "nobody has seen this yet".
- Never show raw metadata (coordinates, camera model) as the main text. Metadata becomes meaning.
