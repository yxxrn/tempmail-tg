import { describe, it, expect } from "vitest";
import * as db from "../src/db";

describe("db exports", () => {
  it("exports expected functions", () => {
    expect(typeof db.createAddress).toBe("function");
    expect(typeof db.listActiveDomains).toBe("function");
    expect(typeof db.insertMail).toBe("function");
  });
});
