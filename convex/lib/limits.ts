/** Run engine limits. Plain limits, not brakes: past one, a submit says so plainly. */
export const MAX_RUNNING_RUNS_PER_CANVAS = 3;
export const MAX_RUNS_PER_HOUR = 30;
export const MAX_BOARDS = 16;
export const FIND_QUERIES = 3;
export const RESULTS_PER_QUERY = 5;
export const MAX_NEW_CARDS_PER_ROUND = 10;
export const READ_BATCH = 4;
export const MAX_READ_PASSES = 4;
export const MAX_CARDS_PER_BOARD = 60;
export const MAX_ROUNDS = 2;
export const KEEP_TARGET = 6;
export const MAIL_PER_HOUR = 40;
/** A run with no task or stage change for this long is marked failed by the sweep. */
export const RUN_STALE_MS = 4 * 60 * 1000;
export const UNREAD_GRACE_MS = 60 * 1000;
export const DIGEST_COOLDOWN_MS = 10 * 60 * 1000;

export const HOUR_MS = 60 * 60 * 1000;
export const TASK_TTL_MS = 24 * HOUR_MS;
export const MAIL_TTL_MS = 30 * 24 * HOUR_MS;
export const INBOUND_SEEN_TTL_MS = 7 * 24 * HOUR_MS;

export const BOARD_TITLE_MAX = 60;
export const BOARD_PROMPT_MAX = 300;
export const TASK_LABEL_MAX = 140;
export const TASK_NOTE_MAX = 200;
export const MAIL_PREVIEW_MAX = 240;
export const SUBMIT_TEXT_MAX = 2000;
export const SUBMIT_URLS_MAX = 10;
export const AGENT_NAME_MAX = 24;
export const CAPTION_MAX = 150;
export const QUOTE_MAX = 220;
export const WHY_MAX = 100;
