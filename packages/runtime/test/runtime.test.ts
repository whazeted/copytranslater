import { describe, expect, it } from "vitest";
import { createNamespaceLoader, formatNumber, plural, select, setLocale } from "../src/index.js";

describe("runtime helpers", () => {
  it("selects plural and select variants", () => {
    expect(plural(1, { one: () => "one", other: () => "other" }, "en")).toBe("one");
    expect(plural(4, { other: () => "many" }, "en")).toBe("many");
    expect(select("admin", { admin: () => "Admin", other: () => "Other" })).toBe("Admin");
    expect(plural(2, { two: () => "dual", other: () => "other" }, "ar")).toBe("dual");
  });

  it("formats with the active locale", () => {
    setLocale("nl-NL");
    expect(formatNumber(12.5)).toContain("12,5");
  });

  it("loads a namespace once", async () => {
    let calls = 0;
    const load = createNamespaceLoader({ en: { common: async () => ({ value: ++calls }) } });
    const [first, second] = await Promise.all([load("en", "common"), load("en", "common")]);
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });
});
