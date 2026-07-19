import { describe, it, expect } from "vitest";
import { stripHtml } from "../src/mail_parse";

describe("stripHtml", () => {
  it("removes tags", () => {
    expect(stripHtml("<p>Hi <b>there</b></p>")).toContain("Hi");
    expect(stripHtml("<p>Hi</p>")).not.toContain("<p>");
  });
});
