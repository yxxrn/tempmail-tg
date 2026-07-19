import { describe, it, expect } from "vitest";
import {
  isBootstrapAllowed,
  checkApiKey,
  checkWebhookSecret,
} from "../src/auth";
import type { Env } from "../src/env";

const baseEnv = {
  DB: {} as D1Database,
  BOT_TOKEN: "t",
  WEBHOOK_SECRET: "whsec",
  API_KEY: "apikey",
  MULTI_USER: "false",
  ALLOWED_CHAT_IDS: "111,222",
} as Env;

describe("isBootstrapAllowed", () => {
  it("allows listed chat", () => {
    expect(isBootstrapAllowed(baseEnv, "111")).toBe(true);
  });
  it("denies unlisted", () => {
    expect(isBootstrapAllowed(baseEnv, "999")).toBe(false);
  });
});

describe("checkApiKey", () => {
  it("accepts matching header", () => {
    const req = new Request("https://x/api/new", {
      headers: { "X-API-Key": "apikey" },
    });
    expect(checkApiKey(baseEnv, req)).toBe(true);
  });
  it("rejects missing", () => {
    expect(checkApiKey(baseEnv, new Request("https://x"))).toBe(false);
  });
});

describe("checkWebhookSecret", () => {
  it("accepts telegram secret header", () => {
    const req = new Request("https://x/api/telegram", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "whsec" },
    });
    expect(checkWebhookSecret(baseEnv, req)).toBe(true);
  });
});
