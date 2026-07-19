import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/bot_parse";

describe("parseCommand", () => {
  it("parses /new", () => {
    expect(parseCommand("/new")).toEqual({ cmd: "new", args: [] });
  });
  it("parses /new with domain and bot suffix", () => {
    expect(parseCommand("/new@MyBot example.com")).toEqual({
      cmd: "new",
      args: ["example.com"],
    });
  });
  it("returns null for non-command", () => {
    expect(parseCommand("hello")).toBeNull();
  });
});
