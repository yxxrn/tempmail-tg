import { describe, it, expect } from "vitest";
import { truncateBody, BODY_MAX } from "../src/limits";

describe("truncateBody", () => {
  it("leaves short text", () => {
    expect(truncateBody("hi")).toBe("hi");
  });
  it("truncates long text", () => {
    const s = "a".repeat(BODY_MAX + 100);
    const out = truncateBody(s);
    expect(out.length).toBe(BODY_MAX);
  });
});
