"use node";
/**
 * Drawing a circle: from one photo to the world around it.
 *
 * Four agents, in the order a person would think:
 *   1. Visual:    what is in the photo, what kind of moment it is.
 *   2. Context:   where and when, and what the sky and the light were doing
 *                 (runs alongside Visual; metadata becomes meaning).
 *   3. Discovery: looks up the few named things worth knowing more about.
 *   4. Curator:   decides what the page says: names the moment, writes the
 *                 explore notes, adds at most a couple of discovered things.
 *
 * Elements are added the moment each fact is known, so the page draws itself
 * while the work happens; nothing waits for the end. The renderer, not the
 * model, decides how anything looks: the model only picks words, a doodle
 * from the vocabulary, and how much each thing matters.
 */
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { ElementKind } from "../lib/circleFields";
import { FAST, firecrawl, getModel, withTimeout } from "../lib/providers";
import { redactError } from "../lib/redact";
import { DOODLE_IDS, vocabularyText, type DoodleId } from "../lib/vocabulary";
import { dateLabel, forwardGeocode, parseTaken, partOfDay, reverseGeocode, shortDate, skyAt, skyDoodle, type Place, type Sky } from "./world";

const VISION_TIMEOUT_MS = 60_000;
const CURATE_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 20_000;
const MAX_LOOKUPS = 3;
/** Never more than this around one moment (DESIGN.md §10); mirrors MAX_ELEMENTS. */
const MAX_DRAWINGS = 8;
/** A circle is never thinner than this: a photo always gets a world worth looking at. */
const MIN_DRAWINGS = 5;
/** What a finished circle aims for before anything discovered is added. */
const TARGET_DRAWINGS = 6;

type Ctx = ActionCtx;

const note = (ctx: Ctx, circleId: Id<"circles">, text: string) => ctx.runMutation(internal.circles.note, { circleId, text });

async function add(
  ctx: Ctx,
  circleId: Id<"circles">,
  e: {
    kind: ElementKind;
    illustration: DoodleId;
    label: string;
    semanticMeaning: string;
    importance: number;
    detail?: string;
    pointsAt?: { x: number; y: number };
    geo?: { lat: number; lng: number };
    source?: { url: string; title: string };
  },
) {
  return await ctx.runMutation(internal.circles.addElement, { circleId, element: e });
}

// ---------------------------------------------------------------------------
// 1. Visual agent
// ---------------------------------------------------------------------------

const Look = z.object({
  title: z.string().describe("The moment's name in 1–3 lowercase words, the way a friend would caption it: 'paris', 'sunday brunch', 'maya turns 30'."),
  reading: z.string().describe("One warm, plain sentence about what is happening in the photo. No guessing names of people."),
  glance: z.string().describe("What you notice first, as a margin note: lowercase, at most 7 words. 'a warm evening under the tower'."),
  kind: z
    .enum(["trip", "meal", "people", "concert", "place", "nature", "home", "celebration", "pet", "everyday", "idea"])
    .describe("What kind of moment this is."),
  placeGuess: z
    .string()
    .describe("A specific place you can actually recognise (a named landmark, venue or city), else empty. Never invent one."),
  timeOfDay: z.enum(["morning", "midday", "afternoon", "golden hour", "evening", "night", "unknown"]),
  peopleCount: z.number().describe("How many people are clearly in the photo (0 if none)."),
  subjects: z
    .array(
      z.object({
        name: z.string().describe("What it is, 1–3 lowercase words: 'eiffel tower', 'flat white', 'two friends'."),
        doodle: z
          .enum(DOODLE_IDS)
          .describe("The drawing that genuinely depicts it. A fish cake is not a cake and a spoon is not a coffee cup: if no drawing truly fits, leave this thing out."),
        meaning: z.string().describe("Why it matters to this moment, one short clause."),
        importance: z.number().describe("0..1, how central it is to the moment."),
        x: z.number().describe("Where its centre is in the photo, 0 (left) .. 1 (right)."),
        y: z.number().describe("Where its centre is in the photo, 0 (top) .. 1 (bottom)."),
        lookup: z
          .string()
          .describe("A web search worth doing to learn about THIS specific thing (a named landmark, venue, dish, artwork), else empty."),
      }),
    )
    .describe(
      "5 to 7 things in or about the photo worth drawing around it, most important first, each a different drawing. " +
        "Think wider than objects: what they were doing, the occasion, the company, the food, the season, the weather in " +
        "the picture, the mood of the light. Skip anything the vocabulary can't honestly draw, and never repeat a drawing.",
    ),
});
type LookT = z.infer<typeof Look>;

async function lookAtPhoto(photoUrl: string, hints: { note: string | null; takenAt?: string; place?: string; prompt?: string }): Promise<LookT> {
  const { object } = await withTimeout(
    generateObject({
      model: getModel(),
      schema: Look,
      providerOptions: FAST,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Someone gave Small Circles this photo: a moment from their life. Look at it the way a thoughtful friend would. " +
                "Name the moment, say what is happening, and pick the few things around which the story of the moment could be drawn. " +
                "Each thing must map to one drawing from this vocabulary (id: meaning):\n" +
                vocabularyText() +
                "\n\n" +
                (hints.prompt ? `They shared it answering this hour's prompt: "${hints.prompt}".\n` : "") +
                (hints.note ? `They wrote: "${hints.note.slice(0, 300)}"\n` : "") +
                (hints.takenAt ? `The camera says it was taken at ${hints.takenAt} (local time).\n` : "") +
                (hints.place ? `The photo's location is ${hints.place}.\n` : "") +
                "Never identify people by name. Never invent a place you cannot see or were not told.",
            },
            { type: "image", image: new URL(photoUrl) },
          ],
        },
      ],
    }),
    VISION_TIMEOUT_MS,
    "looking at the photo",
  );
  return object;
}

// ---------------------------------------------------------------------------
// 3. Discovery agent (Firecrawl)
// ---------------------------------------------------------------------------

type Found = { query: string; about: string; results: { url: string; title: string; description: string }[] };

async function discover(queries: { query: string; about: string }[]): Promise<Found[]> {
  const out = await Promise.all(
    queries.slice(0, MAX_LOOKUPS).map(async ({ query, about }) => {
      try {
        const res = await withTimeout(firecrawl().search(query, { limit: 3 }), SEARCH_TIMEOUT_MS, "lookup");
        const results: Found["results"] = [];
        for (const r of res.web ?? []) {
          const item = r as { url?: unknown; title?: unknown; description?: unknown; metadata?: { sourceURL?: unknown; title?: unknown; description?: unknown } };
          const url = typeof item.url === "string" ? item.url : typeof item.metadata?.sourceURL === "string" ? item.metadata.sourceURL : "";
          if (!/^https?:\/\//.test(url)) continue;
          const title = typeof item.title === "string" ? item.title : typeof item.metadata?.title === "string" ? item.metadata.title : "";
          const description =
            typeof item.description === "string" ? item.description : typeof item.metadata?.description === "string" ? item.metadata.description : "";
          results.push({ url, title: title.slice(0, 160), description: description.slice(0, 400) });
        }
        return { query, about, results };
      } catch (err) {
        console.warn("lookup failed:", redactError(err));
        return { query, about, results: [] };
      }
    }),
  );
  return out.filter((f) => f.results.length > 0);
}

// ---------------------------------------------------------------------------
// 4. Curator agent
// ---------------------------------------------------------------------------

const Curate = z.object({
  title: z.string().describe("The moment's final name, 1–3 lowercase words."),
  subtitle: z.string().describe("A short lowercase line under the title, at most 6 words: 'golden hour in the 7th', 'dinner after the show'."),
  notes: z
    .array(
      z.object({
        element: z.number().describe("Index of an element already on the page."),
        detail: z.string().describe("One or two plain sentences someone would enjoy reading when they tap it. Grounded in the facts or sources only."),
        source: z.number().describe("Index of the source it came from, or -1."),
      }),
    )
    .describe("An explore note for each element that has something worth saying."),
  add: z
    .array(
      z.object({
        doodle: z.enum(DOODLE_IDS),
        label: z.string().describe("At most 3 lowercase words."),
        meaning: z.string().describe("Why it belongs around this moment, one short clause."),
        detail: z.string().describe("One or two sentences, from the source."),
        source: z.number().describe("Index of the source this comes from. Required: only add what a source supports."),
        importance: z.number().describe("0..1"),
      }),
    )
    .describe(
      "0 to 2 new things discovered AROUND the moment that the page does not show yet: a café nearby, what the landmark is " +
        "famous for, an event that day. Only when a source supports it. Never repeat the place, the date, the weather or anything already on the page.",
    ),
});

// ---------------------------------------------------------------------------
// Keeping a circle full
// ---------------------------------------------------------------------------

const More = z.object({
  things: z
    .array(
      z.object({
        name: z.string().describe("What it is, 1-3 lowercase words."),
        doodle: z.enum(DOODLE_IDS).describe("The drawing that genuinely depicts it, and one not already on the page."),
        meaning: z.string().describe("Why it belongs to this moment, one short clause."),
        importance: z.number().describe("0..1"),
        x: z.number().describe("Its centre in the photo, 0 (left) .. 1 (right)."),
        y: z.number().describe("Its centre in the photo, 0 (top) .. 1 (bottom)."),
      }),
    )
    .describe("More things worth drawing, each a different drawing from the others and from what is already on the page."),
});

/**
 * A second look, only when the circle came out thin. It asks for the things
 * the first pass walked past (what they were doing, the company, the food,
 * the light, the season), so no moment is left with a bare ring.
 */
async function topUp(ctx: Ctx, circleId: Id<"circles">, photoUrl: string, look: LookT): Promise<void> {
  const onPage = await ctx.runQuery(internal.circles.listElements, { circleId });
  const want = TARGET_DRAWINGS - onPage.length;
  if (want <= 0) return;
  try {
    const { object } = await withTimeout(
      generateObject({
        model: getModel(),
        schema: More,
        providerOptions: FAST,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `This moment has only ${onPage.length} things drawn around it, and it needs at least ${TARGET_DRAWINGS}. ` +
                  `Look at the photo again and name ${want + 2} more worth drawing: what they were doing, who they were with, ` +
                  "the food or drink, the weather or light in the picture, the season, the occasion, the place it is. " +
                  "Nothing invented, and nothing the vocabulary cannot honestly draw.\n\n" +
                  `The moment: ${look.reading}\n` +
                  `Already on the page (drawing · label): ${onPage.map((e) => `${e.illustration} · ${e.label}`).join(", ") || "(nothing)"}\n\n` +
                  `Vocabulary (id: meaning):\n${vocabularyText()}`,
              },
              { type: "image", image: new URL(photoUrl) },
            ],
          },
        ],
      }),
      VISION_TIMEOUT_MS,
      "looking again",
    );
    for (const s of object.things.slice(0, Math.max(0, MAX_DRAWINGS - onPage.length))) {
      await add(ctx, circleId, {
        kind: "subject",
        illustration: s.doodle,
        label: s.name,
        semanticMeaning: s.meaning,
        importance: Math.max(0.3, Math.min(0.8, s.importance)),
        pointsAt: { x: Math.max(0, Math.min(1, s.x)), y: Math.max(0, Math.min(1, s.y)) },
      });
    }
  } catch (err) {
    // A thin circle is better than a failed one.
    console.warn("looking again failed:", redactError(err));
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export const run = internalAction({
  args: { circleId: v.id("circles") },
  returns: v.null(),
  handler: async (ctx, { circleId }) => {
    const data = await ctx.runQuery(internal.circles.forDraw, { circleId });
    if (!data || data.circle.status !== "drawing") return null;
    const { circle, photoUrl } = data;
    if (!photoUrl) {
      await ctx.runMutation(internal.circles.finish, { circleId, status: "failed", error: "The photo is missing." });
      return null;
    }
    const meta = circle.metadata;
    const taken = parseTaken(meta.takenAt);
    const hasGps = typeof meta.lat === "number" && typeof meta.lng === "number";

    try {
      await note(ctx, circleId, "looking at the photo…");

      // -- 2. Context agent, part one: when, and (if the photo knows) where. --
      if (taken) {
        await ctx.runMutation(internal.circles.patch, { circleId, dateLabel: dateLabel(taken) });
        await note(ctx, circleId, taken.hour !== undefined ? `${shortDate(taken)}, ${partOfDay(taken.hour)}` : shortDate(taken));
      }
      const placeFromGps: Promise<Place | null> = hasGps ? reverseGeocode(meta.lat!, meta.lng!) : Promise.resolve(null);

      // -- 1. Visual agent, alongside. --
      const gpsPlace = await placeFromGps;
      if (gpsPlace) {
        await note(ctx, circleId, `this is ${(gpsPlace.neighbourhood ?? gpsPlace.city ?? gpsPlace.name).toLowerCase()}`);
      } else if (!hasGps) {
        await note(ctx, circleId, "no location in this one. i'll go by what i see");
      }
      const lookPromise = lookAtPhoto(photoUrl, {
        note: circle.note,
        ...(circle.prompt ? { prompt: circle.prompt } : {}),
        ...(meta.takenAt ? { takenAt: meta.takenAt } : {}),
        ...(gpsPlace ? { place: [gpsPlace.spot, gpsPlace.neighbourhood, gpsPlace.city, gpsPlace.country].filter(Boolean).join(", ") } : {}),
      });

      // Where it was goes on the page as soon as we know.
      const addPlace = async (place: Place) => {
        const area = place.neighbourhood && place.city ? `${place.neighbourhood}, ${place.city}` : place.city ?? place.name;
        await add(ctx, circleId, {
          kind: "place",
          illustration: place.spot ? "pin" : "map",
          label: (place.spot ?? place.city ?? place.name).toLowerCase(),
          semanticMeaning: place.spot ? `right here: ${place.spot}` : `where this was: ${area}`,
          importance: 0.72,
          detail: [place.spot, place.neighbourhood, place.city, place.country].filter(Boolean).join(" · "),
          geo: { lat: place.lat, lng: place.lng },
        });
        await ctx.runMutation(internal.circles.patch, {
          circleId,
          context: {
            place: {
              name: place.name,
              ...(place.spot ? { spot: place.spot } : {}),
              ...(place.neighbourhood ? { neighbourhood: place.neighbourhood } : {}),
              ...(place.city ? { city: place.city } : {}),
              ...(place.country ? { country: place.country } : {}),
              lat: place.lat,
              lng: place.lng,
            },
          },
        });
      };
      if (gpsPlace) await addPlace(gpsPlace);

      if (taken) {
        await add(ctx, circleId, {
          kind: "time",
          illustration: "calendar",
          label: shortDate(taken),
          semanticMeaning: `the day: ${dateLabel(taken)}`,
          importance: 0.42,
          detail: taken.hour !== undefined ? `${dateLabel(taken)}, around ${taken.hour % 12 || 12}${taken.hour < 12 ? "am" : "pm"}.` : dateLabel(taken),
        });
      }

      // The sky, once we know where and when.
      const skyFor = async (place: Place | null): Promise<Sky | null> => {
        if (!place || !taken) return null;
        const sky = await skyAt(place.lat, place.lng, taken);
        if (!sky) return null;
        await add(ctx, circleId, {
          kind: "weather",
          illustration: skyDoodle(sky),
          label: sky.light ?? sky.label,
          semanticMeaning: sky.light ? `the light: ${sky.light}` : `the weather: ${sky.label}`,
          importance: sky.light ? 0.6 : 0.4,
          detail: [sky.light, sky.label].filter(Boolean).join(" · "),
        });
        await ctx.runMutation(internal.circles.patch, {
          circleId,
          context: {
            weather: { label: sky.label, ...(sky.tempC !== undefined ? { tempC: sky.tempC } : {}), ...(sky.code !== undefined ? { code: sky.code } : {}) },
            ...(sky.light ? { light: sky.light } : {}),
            ...(sky.isNight ? { palette: "night" } : sky.light ? { palette: "warm" } : {}),
          },
        });
        await note(ctx, circleId, sky.light ? `${sky.light}, ${sky.label}` : sky.label);
        return sky;
      };
      const skyPromise = skyFor(gpsPlace);

      // -- The photo, read. --
      const look = await lookPromise;
      await ctx.runMutation(internal.circles.patch, {
        circleId,
        title: look.title,
        context: {
          reading: look.reading,
          kind: look.kind,
          peopleCount: Math.max(0, Math.round(look.peopleCount)),
          ...(taken?.hour === undefined && look.timeOfDay !== "unknown" ? { timeOfDay: look.timeOfDay } : {}),
          ...(taken?.hour !== undefined ? { timeOfDay: partOfDay(taken.hour) } : {}),
          palette: look.timeOfDay === "night" ? "night" : look.kind === "meal" || look.timeOfDay === "golden hour" ? "warm" : "cool",
        },
      });
      await note(ctx, circleId, look.glance.toLowerCase().replace(/\.$/, ""));

      // No GPS: the photo may still show where it was.
      let place = gpsPlace;
      let sky: Sky | null = null;
      if (!place && look.placeGuess.trim()) {
        place = await forwardGeocode(look.placeGuess);
        if (place) {
          await note(ctx, circleId, `looks like ${(place.city ?? place.name).toLowerCase()}`);
          await addPlace(place);
          sky = await skyFor(place);
        }
      }
      sky = sky ?? (await skyPromise);

      // The things in the photo. Enough of them that every circle has a full
      // world around it, with a slot kept free for anything discovered later.
      const onPageBefore = (await ctx.runQuery(internal.circles.listElements, { circleId })).length;
      const subjectRoom = Math.max(0, Math.min(MAX_DRAWINGS - 1 - onPageBefore, TARGET_DRAWINGS));
      const subjects = [...look.subjects].sort((a, b) => b.importance - a.importance).slice(0, subjectRoom);
      const subjectIds: { id: Id<"circleElements">; name: string }[] = [];
      for (const s of subjects) {
        const id = await add(ctx, circleId, {
          kind: "subject",
          illustration: s.doodle,
          label: s.name,
          semanticMeaning: s.meaning,
          importance: Math.max(0.3, Math.min(1, s.importance)),
          pointsAt: { x: Math.max(0, Math.min(1, s.x)), y: Math.max(0, Math.min(1, s.y)) },
        });
        if (id) subjectIds.push({ id, name: s.name });
      }

      // Some photos give the model little to work with, and duplicates are
      // turned away, so a thin circle asks it to look again for what it missed.
      await topUp(ctx, circleId, photoUrl, look);

      // -- 3. Discovery agent: the few named things worth knowing more about. --
      const lookups: { query: string; about: string }[] = [];
      for (const s of subjects) if (s.lookup.trim()) lookups.push({ query: s.lookup.trim().slice(0, 120), about: s.name });
      if (place?.spot) lookups.push({ query: `${place.spot} ${place.city ?? ""}`.trim(), about: place.spot });
      else if (place?.neighbourhood && place.city && lookups.length < 2) {
        lookups.push({ query: `${place.neighbourhood} ${place.city} neighbourhood known for`, about: place.neighbourhood });
      }
      const unique = lookups.filter((l, i) => lookups.findIndex((x) => x.query.toLowerCase() === l.query.toLowerCase()) === i);
      if (unique.length) await note(ctx, circleId, `reading about ${unique[0].about.toLowerCase()}…`);
      const found = await discover(unique);

      // -- 4. Curator agent: name it, write the notes, add what the sources support. --
      const onPage = await ctx.runQuery(internal.circles.listElements, { circleId });
      const sources = found.flatMap((f) => f.results.map((r) => ({ ...r, about: f.about })));
      const { object: cur } = await withTimeout(
        generateObject({
          model: getModel(),
          schema: Curate,
          providerOptions: FAST,
          prompt:
            "You finish a Small Circle: a photo of a moment with small drawings around it. Warm, plain, lowercase, brief. " +
            "Never mention AI, searches, sources or data. Never invent facts: use only what is below.\n\n" +
            `The moment: ${look.reading}\nKind: ${look.kind}\nWorking title: ${look.title}\n` +
            (circle.prompt ? `It answers the prompt: "${circle.prompt}" (context only: never reuse the prompt's words as the title or subtitle)\n` : "") +
            (circle.note ? `They wrote: "${circle.note.slice(0, 300)}"\n` : "") +
            (taken ? `When: ${dateLabel(taken)}${taken.hour !== undefined ? `, ${partOfDay(taken.hour)}` : ""}\n` : "") +
            (place ? `Where: ${[place.spot, place.neighbourhood, place.city, place.country].filter(Boolean).join(", ")}\n` : "") +
            (sky ? `Sky: ${[sky.light, sky.label].filter(Boolean).join(", ")}\n` : "") +
            `\nOn the page already (index: drawing · label · meaning):\n` +
            onPage.map((e, i) => `${i}: ${e.illustration} · ${e.label} · ${e.kind}`).join("\n") +
            `\n\nSources (index: about · title · what it says · url):\n` +
            (sources.length ? sources.map((s, i) => `${i}: ${s.about} · ${s.title} · ${s.description} · ${s.url}`).join("\n") : "(none)") +
            `\n\nVocabulary for new drawings (id: meaning):\n${vocabularyText()}\n\n` +
            `Room on the page for ${Math.max(0, MAX_DRAWINGS - onPage.length)} more drawings.`,
        }),
        CURATE_TIMEOUT_MS,
        "finishing the circle",
      );

      await ctx.runMutation(internal.circles.patch, { circleId, title: cur.title, subtitle: cur.subtitle });
      for (const n of cur.notes) {
        const target = onPage[n.element];
        if (!target || !n.detail.trim()) continue;
        const src = sources[n.source];
        await ctx.runMutation(internal.circles.enrichElement, {
          elementId: target._id,
          detail: n.detail.trim(),
          ...(src ? { source: { url: src.url, title: src.title || src.about } } : {}),
        });
      }
      // Discoveries are things, not the sky or the clock again.
      const NOT_DISCOVERIES = new Set(["sun", "sunset", "moon", "cloud", "rain", "snow", "calendar", "clock", "star", "camera", "map"]);
      for (const a of cur.add.slice(0, Math.max(0, MAX_DRAWINGS - onPage.length))) {
        const src = sources[a.source];
        if (!src || NOT_DISCOVERIES.has(a.doodle)) continue; // discovered things must come from somewhere real
        const id = await add(ctx, circleId, {
          kind: "discovered",
          illustration: a.doodle,
          label: a.label,
          semanticMeaning: a.meaning,
          importance: Math.max(0.25, Math.min(0.7, a.importance)),
          detail: a.detail,
          source: { url: src.url, title: src.title || src.about },
        });
        if (id) await note(ctx, circleId, `found: ${a.label}`);
      }

      // Last guard: a circle never finishes with a bare ring.
      const drawn = await ctx.runQuery(internal.circles.listElements, { circleId });
      if (drawn.length < MIN_DRAWINGS) await topUp(ctx, circleId, photoUrl, look);

      await note(ctx, circleId, "there. that's the moment.");
      await ctx.runMutation(internal.circles.finish, { circleId, status: "done" });
    } catch (err) {
      console.error("draw failed:", redactError(err));
      const got = await ctx.runQuery(internal.circles.listElements, { circleId });
      // Whatever was found stays: a partly drawn circle beats an error page.
      await note(ctx, circleId, got.length ? "that's what i could make out." : "i couldn't read this one, sorry.");
      await ctx.runMutation(internal.circles.finish, {
        circleId,
        status: got.length ? "done" : "failed",
        ...(got.length ? {} : { error: "Couldn't read this photo." }),
      });
    }
    return null;
  },
});
