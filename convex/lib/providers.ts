"use node";
import { createOpenAI } from "@ai-sdk/openai";
import { Firecrawl } from "firecrawl";
import { AgentMailClient } from "agentmail";
import { redact, redactError } from "./redact";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

/** gpt-5 models reject temperature; every call runs with minimal reasoning. */
export const FAST = { openai: { reasoningEffort: "minimal" as const } };

export function getModel() {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai(MODEL);
}

export function firecrawl(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
  return new Firecrawl({ apiKey });
}

/** AgentMail client. Key comes from the deployment env, never from args. */
export function mailClient(): AgentMailClient {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is not set");
  return new AgentMailClient({ apiKey });
}

/** Redacted one-line description of a provider SDK error, including the response body. */
export function describeProviderError(err: unknown): string {
  const e = err as { statusCode?: number; body?: unknown };
  let body = "";
  try {
    body = typeof e.body === "string" ? e.body : JSON.stringify(e.body ?? "");
  } catch {
    body = "";
  }
  return redact(`${e.statusCode ?? ""} ${redactError(err)} ${body}`.replace(/\s+/g, " ").trim(), 200);
}

/** Reject after `ms` so one slow provider call cannot hold a run. */
export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
