import { describe, it, expect } from "vitest";
import { extractOtp, extractUrls } from "../src/otp";

describe("extractOtp", () => {
  it("finds code near keyword", () => {
    expect(extractOtp("Your verification code is 482913. Expires soon.")).toBe(
      "482913"
    );
  });

  it("returns null when no code", () => {
    expect(extractOtp("Hello friend, see you at 12")).toBeNull();
  });

  it("prefers 6-digit OTP", () => {
    expect(extractOtp("OTP: 123456")).toBe("123456");
  });
});

describe("extractUrls", () => {
  it("extracts https links", () => {
    const urls = extractUrls("Click https://example.com/verify?t=abc now");
    expect(urls).toEqual(["https://example.com/verify?t=abc"]);
  });
});
