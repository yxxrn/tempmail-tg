import { describe, it, expect } from "vitest";
import { randomId, randomToken, randomLocalPart } from "../src/ids";

describe("ids", () => {
  it("randomId returns 32 hex chars", () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("randomToken returns 64 hex chars", () => {
    const t = randomToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("randomLocalPart is 10 lowercase alnum", () => {
    const p = randomLocalPart();
    expect(p).toMatch(/^[a-z0-9]{10}$/);
  });
});
