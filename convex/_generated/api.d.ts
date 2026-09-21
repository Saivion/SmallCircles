/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentmail from "../agentmail.js";
import type * as agents from "../agents.js";
import type * as agents_brief from "../agents/brief.js";
import type * as agents_find from "../agents/find.js";
import type * as agents_follow from "../agents/follow.js";
import type * as agents_group from "../agents/group.js";
import type * as agents_read from "../agents/read.js";
import type * as agents_sort from "../agents/sort.js";
import type * as agents_team from "../agents/team.js";
import type * as boards from "../boards.js";
import type * as canvases from "../canvases.js";
import type * as cards from "../cards.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_cells from "../lib/cells.js";
import type * as lib_crew from "../lib/crew.js";
import type * as lib_engine from "../lib/engine.js";
import type * as lib_footer from "../lib/footer.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_redact from "../lib/redact.js";
import type * as lib_svix from "../lib/svix.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mail from "../mail.js";
import type * as runs from "../runs.js";
import type * as search from "../search.js";
import type * as searchStore from "../searchStore.js";
import type * as sites from "../sites.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentmail: typeof agentmail;
  agents: typeof agents;
  "agents/brief": typeof agents_brief;
  "agents/find": typeof agents_find;
  "agents/follow": typeof agents_follow;
  "agents/group": typeof agents_group;
  "agents/read": typeof agents_read;
  "agents/sort": typeof agents_sort;
  "agents/team": typeof agents_team;
  boards: typeof boards;
  canvases: typeof canvases;
  cards: typeof cards;
  crons: typeof crons;
  http: typeof http;
  "lib/cells": typeof lib_cells;
  "lib/crew": typeof lib_crew;
  "lib/engine": typeof lib_engine;
  "lib/footer": typeof lib_footer;
  "lib/limits": typeof lib_limits;
  "lib/providers": typeof lib_providers;
  "lib/redact": typeof lib_redact;
  "lib/svix": typeof lib_svix;
  "lib/text": typeof lib_text;
  "lib/validators": typeof lib_validators;
  mail: typeof mail;
  runs: typeof runs;
  search: typeof search;
  searchStore: typeof searchStore;
  sites: typeof sites;
  tasks: typeof tasks;
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
