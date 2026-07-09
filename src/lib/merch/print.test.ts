import { describe, expect, it } from "vitest";
import { buildShopUrl, DEFAULT_PAYLOAD, sanitizePayload, SUB_MAX, TITLE_MAX } from "./print";

describe("sanitizePayload", () => {
  it("uppercases and keeps allowed characters", () => {
    expect(sanitizePayload({ title: "Arena Champion!", sub: "3 KO · Jul 9 2026" })).toEqual({
      title: "ARENA CHAMPION!",
      sub: "3 KO · JUL 9 2026",
    });
  });

  it("strips disallowed characters and collapses whitespace", () => {
    expect(sanitizePayload({ title: "<b>win</b>", sub: "a\n\t  b" })).toEqual({
      title: "BWINB",
      sub: "A B",
    });
  });

  it("clamps to the print area", () => {
    const long = "X".repeat(100);
    const out = sanitizePayload({ title: long, sub: long });
    expect(out.title).toHaveLength(TITLE_MAX);
    expect(out.sub).toHaveLength(SUB_MAX);
  });

  it("falls back to defaults when empty or fully stripped", () => {
    expect(sanitizePayload({})).toEqual(DEFAULT_PAYLOAD);
    expect(sanitizePayload({ title: "@@@", sub: "" })).toEqual(DEFAULT_PAYLOAD);
  });

  it("masks blocklisted words (they go on office walls)", () => {
    expect(sanitizePayload({ title: "holy shit" }).title).toBe("HOLY ****");
  });
});

describe("buildShopUrl", () => {
  it("carries the payload as query params", () => {
    const url = buildShopUrl("tee", { title: "CHAMPION", sub: "JUL 9" });
    expect(url).toBe("/shop/tee?title=CHAMPION&sub=JUL+9");
  });
});
