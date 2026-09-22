import { v, type Infer } from "convex/values";

/** Where the moment came from. */

export const vCircleStatus = v.union(v.literal("drawing"), v.literal("done"), v.literal("failed"));

/** What the photo's own file said about itself (read in the browser, or from the attachment). */
export const vPhotoMeta = v.object({
  /** Wall-clock time the photo was taken, as written by the camera ("2026-06-14T20:32:00"), no zone. */
  takenAt: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  camera: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/** What we worked out around the moment. Meaning, not metadata. */
export const vContext = v.object({
  /** One sentence: what is happening in the moment. */
  reading: v.optional(v.string()),
  /** trip, meal, people, concert, place, nature, home, celebration, everyday, pet, idea */
  kind: v.optional(v.string()),
  place: v.optional(
    v.object({
      name: v.string(),
      /** The named spot the coordinates landed on (a café, a shrine), when there is one. */
      spot: v.optional(v.string()),
      neighbourhood: v.optional(v.string()),
      city: v.optional(v.string()),
      country: v.optional(v.string()),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
    }),
  ),
  /** "golden hour", "evening", "late night"… */
  timeOfDay: v.optional(v.string()),
  /** "just before sunset", "an hour after sunrise" */
  light: v.optional(v.string()),
  weather: v.optional(v.object({ label: v.string(), tempC: v.optional(v.number()), code: v.optional(v.number()) })),
  /** warm | cool | night: which markers the renderer reaches for. */
  palette: v.optional(v.string()),
  peopleCount: v.optional(v.number()),
});

export const circleFields = {
  canvasId: v.id("canvases"),
  /** The moment's name, lowercase: "paris", "sunday brunch". */
  title: v.string(),
  /** A short line under it: "evening in the 7th". */
  subtitle: v.optional(v.string()),
  /** "june 14, 2026" */
  dateLabel: v.optional(v.string()),
  primaryMedia: v.object({
    storageId: v.id("_storage"),
    contentType: v.optional(v.string()),
  }),
  metadata: vPhotoMeta,
  context: vContext,
  status: vCircleStatus,
  /** Seeds the renderer: wobble, tilt, start angle, palette, rotations. */
  generationSeed: v.number(),
  /** The caption the person shared it with. */
  note: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  finishedAt: v.optional(v.number()),

  // -- The hour: every moment answers the prompt that was up when it was shared. --
  /** hourOf(createdAt); circles from before the hourly prompt have none and stay private. */
  hour: v.optional(v.number()),
  /** The prompt it answered. */
  prompt: v.optional(v.string()),
  /** Who shared it, as they're known here ("amber fox"). */
  author: v.optional(v.string()),
  /** In circulation: others can find it. Only released circles are ever shown to anyone else. */
  released: v.optional(v.boolean()),
  /** Give to get: moments the author still has to visit before this one goes out. */
  owed: v.optional(v.number()),
  /** Distinct people (not the author) who have opened it. The least-seen go out first. */
  views: v.optional(v.number()),
  /** Things other people have added to it. */
  contributionCount: v.optional(v.number()),
  /** Contributions the author hasn't seen yet. */
  unseen: v.optional(v.number()),
  /** A starter moment from the house, so the page is never empty. */
  seeded: v.optional(v.boolean()),

  // -- Where it was, as keys other circles can be matched on (see convex/lib/match.ts). --
  /** "tokyo|japan": the city, normalised. */
  cityKey: v.optional(v.string()),
  /** A ~1 km grid cell ("3566:13970"), only when the camera recorded GPS: guesses never count as exact. */
  geoCell: v.optional(v.string()),
  /** When the photo's own GPS said where, for distances between two circles. Never returned to anyone. */
  gps: v.optional(v.object({ lat: v.number(), lng: v.number() })),
  /** The named spot, normalised ("ichiran shibuya"). */
  spotKey: v.optional(v.string()),
  /** The neighbourhood, normalised. */
  hoodKey: v.optional(v.string()),
  /** Crossed paths with this many other people's moments. */
  connectionCount: v.optional(v.number()),
  /** When its owner was last emailed that it grew (the digest only counts what came after). */
  grewNotifiedAt: v.optional(v.number()),
};

/** What someone added to another person's circle. */
export const vContributionType = v.union(
  v.literal("note"), // a few words
  v.literal("memory"), // "this reminds me of…", "i was here in 2022"
  v.literal("photo"), // a related photo of their own
  v.literal("reaction"), // one drawing and one word
);

export const contributionFields = {
  circleId: v.id("circles"),
  /** The contributor's workspace. Never returned to anyone. */
  canvasId: v.id("canvases"),
  /** Who they are here. */
  by: v.string(),
  type: vContributionType,
  /** The words, for a note, memory or photo caption. */
  text: v.optional(v.string()),
  /** The drawing it's shown with (a DoodleId). Chosen by the person for a reaction, by Small Circles otherwise. */
  illustration: v.string(),
  /** One to three words under the drawing. */
  label: v.string(),
  /** A related photo. */
  storageId: v.optional(v.id("_storage")),
  /** "reading" while Small Circles looks at it; "ok" once it's settled. */
  state: v.union(v.literal("reading"), v.literal("ok")),
  /** Came as a reply to one of our emails, rather than from the page. */
  via: v.optional(v.literal("email")),
  /** What the email was, as Small Circles read it: memory, photo, note, link, context, correction. */
  emailKind: v.optional(v.string()),
  createdAt: v.number(),
};

/** Why an element is on the page. */
export const vElementKind = v.union(
  v.literal("subject"), // something in the photo
  v.literal("place"), // where it was
  v.literal("time"), // when it was
  v.literal("weather"), // what the sky was doing
  v.literal("discovered"), // context found around it
);

export const elementFields = {
  circleId: v.id("circles"),
  /** Drawing order and composition order; lower is more important. */
  order: v.number(),
  kind: vElementKind,
  /** A DoodleId from lib/vocabulary.ts. */
  illustration: v.string(),
  /** Handwritten label, at most three words, lowercase. */
  label: v.string(),
  /** What it means in this moment, one line. */
  semanticMeaning: v.string(),
  /** 0..1: how large and how central it is drawn. */
  importance: v.number(),
  /** The explore card: one or two sentences of context. */
  detail: v.optional(v.string()),
  source: v.optional(v.object({ url: v.string(), title: v.string() })),
  /** Where in the photo this thing is (0..1), when it is in the photo: the arrow points here. */
  pointsAt: v.optional(v.object({ x: v.number(), y: v.number() })),
  /** A place to show on the explore card's little map. */
  geo: v.optional(v.object({ lat: v.number(), lng: v.number() })),
  createdAt: v.number(),
};

export type ElementKind = Infer<typeof vElementKind>;
export type CircleContext = Infer<typeof vContext>;
export type PhotoMeta = Infer<typeof vPhotoMeta>;

// ---------------------------------------------------------------------------
// The Circle Agent: events it wakes on, connections it makes, mail it sends.
// ---------------------------------------------------------------------------

/** What woke the agent. It only ever wakes on one of these; it never runs on a loop. */
export const vAgentEventType = v.union(
  v.literal("circle_created"), // drawn and out in the world
  v.literal("contribution_added"), // someone added something (on the page or by email)
  v.literal("circle_grew"), // a batch window closed: decide whether the owner should hear
  v.literal("circle_updated"), // redrawn: look again, quietly
);

export const agentEventFields = {
  circleId: v.id("circles"),
  type: vAgentEventType,
  /** Idempotency: one event per key, ever ("created:<circle>", "contrib:<contribution>"). */
  key: v.string(),
  /** How many agent steps led here. Events the agent itself causes are depth + 1, capped. */
  depth: v.number(),
  /** Anything the evaluation needs that isn't on the circle (a contribution id). */
  ref: v.optional(v.string()),
  /** Connections made from this event show in the app but email nobody (a backfill). */
  quiet: v.optional(v.boolean()),
  createdAt: v.number(),
  processedAt: v.optional(v.number()),
  /** What the agent decided: "nothing: …", "connected: …", "notified: …". Silence is a result. */
  result: v.optional(v.string()),
};

/** How two moments are related. */
export const vConnectionType = v.union(
  v.literal("same_place"),
  v.literal("same_landmark"),
  v.literal("nearby"),
  v.literal("same_day"),
  v.literal("similar_moment"),
);

export const connectionFields = {
  /** The earlier moment. */
  sourceCircleId: v.id("circles"),
  /** The later one, whose arrival found the link. */
  targetCircleId: v.id("circles"),
  /** Both ids, sorted: one connection per pair, whichever side found it. */
  pairKey: v.string(),
  type: vConnectionType,
  /** One plain sentence a person would say ("both were taken at the same restaurant in shibuya"). */
  reason: v.string(),
  /** 0..1, from the match signals; only ≥ the threshold ever becomes a connection. */
  confidence: v.number(),
  /** The signals that scored, for the record. */
  signals: v.array(v.string()),
  createdAt: v.number(),
};

export const vNotificationType = v.union(v.literal("connection"), v.literal("grew"));

export const notificationFields = {
  circleId: v.id("circles"),
  /** The person (workspace) it's for, and the address it went to. */
  recipientId: v.id("canvases"),
  to: v.string(),
  type: vNotificationType,
  /** Why this person benefits from knowing, from the meaning gate. */
  reason: v.string(),
  /** Never send the same thing twice: one row per key, ever. */
  dedupeKey: v.string(),
  status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed")),
  subject: v.string(),
  /** The AgentMail thread: a reply to it is a contribution to this circle. */
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  error: v.optional(v.string()),
  /** Tries so far (a failed send may be tried again, up to three times). */
  attempts: v.optional(v.number()),
  createdAt: v.number(),
  sentAt: v.optional(v.number()),
};
