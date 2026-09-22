/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_run from "../agent/run.js";
import type * as agent_store from "../agent/store.js";
import type * as agentmail from "../agentmail.js";
import type * as canvases from "../canvases.js";
import type * as circles from "../circles.js";
import type * as contributions from "../contributions.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_circleFields from "../lib/circleFields.js";
import type * as lib_exif from "../lib/exif.js";
import type * as lib_hour from "../lib/hour.js";
import type * as lib_match from "../lib/match.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_reactions from "../lib/reactions.js";
import type * as lib_redact from "../lib/redact.js";
import type * as lib_samples from "../lib/samples.js";
import type * as lib_stripGps from "../lib/stripGps.js";
import type * as lib_svix from "../lib/svix.js";
import type * as lib_vocabulary from "../lib/vocabulary.js";
import type * as moments_contribute from "../moments/contribute.js";
import type * as moments_draw from "../moments/draw.js";
import type * as moments_inbox from "../moments/inbox.js";
import type * as moments_world from "../moments/world.js";
import type * as people from "../people.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/run": typeof agent_run;
  "agent/store": typeof agent_store;
  agentmail: typeof agentmail;
  canvases: typeof canvases;
  circles: typeof circles;
  contributions: typeof contributions;
  crons: typeof crons;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/circleFields": typeof lib_circleFields;
  "lib/exif": typeof lib_exif;
  "lib/hour": typeof lib_hour;
  "lib/match": typeof lib_match;
  "lib/names": typeof lib_names;
  "lib/providers": typeof lib_providers;
  "lib/reactions": typeof lib_reactions;
  "lib/redact": typeof lib_redact;
  "lib/samples": typeof lib_samples;
  "lib/stripGps": typeof lib_stripGps;
  "lib/svix": typeof lib_svix;
  "lib/vocabulary": typeof lib_vocabulary;
  "moments/contribute": typeof moments_contribute;
  "moments/draw": typeof moments_draw;
  "moments/inbox": typeof moments_inbox;
  "moments/world": typeof moments_world;
  people: typeof people;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
