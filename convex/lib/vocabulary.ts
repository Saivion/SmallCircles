/**
 * The illustration vocabulary: every concept a circle can draw.
 *
 * Shared by the backend (the model may only choose from these ids) and the
 * renderer (each id has a primitive in src/lib/doodle/primitives.ts). Adding a
 * drawing means adding an entry here and a primitive there, nothing else.
 */

export type Marker = "sun" | "coral" | "sky" | "leaf" | "lilac" | "blush";

export type Doodle = {
  id: string;
  group: "place" | "nature" | "time" | "food" | "travel" | "people" | "things";
  /** What the model reads when choosing a drawing. */
  means: string;
  /** Default marker fill; the renderer may swap it to fit the circle's palette. */
  marker: Marker | null;
};

export const DOODLES = [
  // place
  { id: "pin", group: "place", means: "a specific spot, an address, 'here'", marker: "coral" },
  { id: "map", group: "place", means: "a city, neighbourhood or region; where this was", marker: "sky" },
  { id: "tower", group: "place", means: "a tall lattice or spire landmark (e.g. Eiffel Tower, Tokyo Tower, a radio mast)", marker: "sun" },
  { id: "dome", group: "place", means: "a domed landmark: cathedral, capitol, mosque, observatory", marker: "sun" },
  { id: "arch", group: "place", means: "an arch or gate landmark (Arc de Triomphe, a torii, a city gate)", marker: "sun" },
  { id: "bridge", group: "place", means: "a bridge or pier", marker: "sky" },
  { id: "building", group: "place", means: "a building, museum, hotel, office or venue", marker: "sun" },
  { id: "house", group: "place", means: "home, a house, a cabin, somewhere lived in", marker: "coral" },
  { id: "skyline", group: "place", means: "a city skyline, downtown, rooftops", marker: "sky" },
  { id: "mountain", group: "place", means: "mountains, hills, a hike, a view from high up", marker: "leaf" },
  { id: "ferris_wheel", group: "place", means: "a fair, amusement park, pier ride, carnival", marker: "coral" },
  { id: "tent", group: "place", means: "camping, a festival, the outdoors overnight", marker: "leaf" },
  // nature
  { id: "sun", group: "nature", means: "daytime, sunshine, heat, golden hour", marker: "sun" },
  { id: "sunset", group: "nature", means: "sunset or sunrise, dusk, dawn, the sun on the horizon", marker: "coral" },
  { id: "moon", group: "nature", means: "night, late evening, moonlight", marker: "sky" },
  { id: "cloud", group: "nature", means: "clouds, overcast, grey weather", marker: "sky" },
  { id: "rain", group: "nature", means: "rain, drizzle, wet streets, storms", marker: "sky" },
  { id: "snow", group: "nature", means: "snow, winter, cold", marker: "sky" },
  { id: "wave", group: "nature", means: "the sea, beach, a lake, a river, swimming", marker: "sky" },
  { id: "palm", group: "nature", means: "a palm tree, the tropics, a beach holiday", marker: "leaf" },
  { id: "tree", group: "nature", means: "trees, a park, a forest, autumn leaves", marker: "leaf" },
  { id: "flower", group: "nature", means: "flowers, a garden, spring, a bouquet", marker: "coral" },
  { id: "leaf", group: "nature", means: "plants, greenery, a season turning", marker: "leaf" },
  // time
  { id: "clock", group: "time", means: "a time of day that matters", marker: null },
  { id: "calendar", group: "time", means: "the date, an anniversary, a birthday, a day of the week", marker: "coral" },
  { id: "star", group: "time", means: "stars, a special occasion, something memorable", marker: "sun" },
  // food & drink
  { id: "coffee", group: "food", means: "coffee, tea, a café, breakfast", marker: "coral" },
  { id: "wine", group: "food", means: "wine, drinks, a bar, a toast, cocktails", marker: "coral" },
  { id: "plate", group: "food", means: "a meal, a restaurant, dinner, lunch", marker: "sun" },
  { id: "bowl", group: "food", means: "ramen, noodles, soup, a bowl of food", marker: "sun" },
  { id: "cake", group: "food", means: "cake, dessert, a birthday, a celebration", marker: "coral" },
  { id: "icecream", group: "food", means: "ice cream, gelato, a summer treat", marker: "coral" },
  { id: "pizza", group: "food", means: "pizza, street food, a casual meal", marker: "sun" },
  // travel
  { id: "plane", group: "travel", means: "a flight, an airport, travelling far", marker: "sky" },
  { id: "car", group: "travel", means: "a car, a road trip, driving", marker: "coral" },
  { id: "train", group: "travel", means: "a train, a metro, a station", marker: "sky" },
  { id: "bike", group: "travel", means: "a bicycle, cycling", marker: "leaf" },
  { id: "boat", group: "travel", means: "a boat, ferry, sailing, a harbour", marker: "sky" },
  { id: "suitcase", group: "travel", means: "a trip, luggage, being away from home", marker: "coral" },
  { id: "hot_air_balloon", group: "travel", means: "a hot-air balloon, a balloon ride, balloons over a valley (e.g. Cappadocia)", marker: "coral" },
  { id: "ticket", group: "travel", means: "a ticket: a show, a concert, a match, a museum, a train", marker: "sun" },
  // people
  { id: "person", group: "people", means: "one person in the moment", marker: "coral" },
  { id: "people", group: "people", means: "two or more people, friends, family, a crowd", marker: "coral" },
  { id: "heart", group: "people", means: "love, a partner, affection, something dear", marker: "coral" },
  { id: "dog", group: "people", means: "a dog", marker: "sun" },
  { id: "cat", group: "people", means: "a cat", marker: "sun" },
  // things
  { id: "camera", group: "things", means: "photography, the photo itself, sightseeing", marker: null },
  { id: "music", group: "things", means: "music, a concert, a gig, a song, dancing", marker: "sky" },
  { id: "book", group: "things", means: "a book, reading, a library, study", marker: "leaf" },
  { id: "gift", group: "things", means: "a gift, a birthday, a surprise", marker: "coral" },
  { id: "ball", group: "things", means: "sport, a game, a match, playing", marker: "sun" },
  { id: "art", group: "things", means: "art, a painting, a gallery, a museum piece", marker: "coral" },
  { id: "shopping", group: "things", means: "shopping, a market, a store, something bought", marker: "sun" },
  { id: "umbrella", group: "things", means: "an umbrella, a rainy day out, shade at the beach", marker: "blush" },
  { id: "balloon", group: "things", means: "party balloons on strings, a birthday, a fair (not hot-air balloons)", marker: "blush" },
  { id: "candle", group: "things", means: "candles, a cosy evening, a dinner by candlelight, a vigil", marker: "sun" },
  { id: "kite", group: "things", means: "a kite, a windy day, a beach or park afternoon, play", marker: "lilac" },
  { id: "headphones", group: "things", means: "headphones, listening to music alone, a commute, a podcast", marker: "lilac" },
  { id: "guitar", group: "things", means: "a guitar, live music, busking, someone playing", marker: "sun" },
  { id: "sunglasses", group: "things", means: "sunglasses, a bright day, summer, a holiday look", marker: "lilac" },
  { id: "lighthouse", group: "place", means: "a lighthouse, a harbour, a rocky coast", marker: "coral" },
  { id: "rainbow", group: "nature", means: "a rainbow, the sky after rain", marker: "sky" },
  { id: "bird", group: "nature", means: "a bird, birdsong, gulls at the sea, pigeons in a square", marker: "sky" },
  { id: "fish", group: "nature", means: "fish, an aquarium, a fish market, snorkelling, sushi", marker: "sky" },
  { id: "cactus", group: "nature", means: "a cactus, a houseplant, the desert", marker: "leaf" },
  { id: "croissant", group: "food", means: "a croissant, pastries, a bakery, breakfast", marker: "sun" },
] as const satisfies readonly Doodle[];

export type DoodleId = (typeof DOODLES)[number]["id"];

export const DOODLE_IDS = DOODLES.map((d) => d.id) as unknown as readonly [DoodleId, ...DoodleId[]];

const byId = new Map<string, Doodle>(DOODLES.map((d) => [d.id, d]));

export function doodleFor(id: string): Doodle | undefined {
  return byId.get(id);
}

export function isDoodleId(id: string): id is DoodleId {
  return byId.has(id);
}

/** One line per doodle, for a prompt. */
export function vocabularyText(): string {
  return DOODLES.map((d) => `${d.id}: ${d.means}`).join("\n");
}
