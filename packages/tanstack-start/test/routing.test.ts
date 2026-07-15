import { describe, expect, it } from "vitest";
import { createStart } from "@tanstack/react-start";
import { createCopyTranslaterMiddleware } from "../src/middleware.js";
import { createI18nRequest, hydrateI18nState } from "../src/request.js";
import { localizeHref, parseAcceptLanguage, resolveLocaleRequest } from "../src/routing.js";

const options = {
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  prefix: "all-except-source",
  strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
} as const;

describe("locale routing", () => {
  it("registers as TanStack Start request middleware", () => {
    const middleware = createCopyTranslaterMiddleware(options);
    const start = createStart(() => ({ requestMiddleware: [middleware] }));
    expect(start).toBeDefined();
  });

  it("resolves URL, cookie, language, and source fallback in order", () => {
    expect(resolveLocaleRequest(new Request("https://example.test/de/cart", { headers: { cookie: "copytranslater-locale=nl", "accept-language": "en" } }), options).locale).toBe("de");
    expect(resolveLocaleRequest(new Request("https://example.test/", { headers: { cookie: "copytranslater-locale=nl" } }), options).locale).toBe("nl");
    expect(resolveLocaleRequest(new Request("https://example.test/", { headers: { "accept-language": "fr;q=.9, de-DE;q=.8" } }), options).locale).toBe("de");
    expect(resolveLocaleRequest(new Request("https://example.test/"), options).locale).toBe("en");
  });

  it("parses quality values and regional matches", () => {
    expect(parseAcceptLanguage("de;q=.4, nl-NL;q=.9", options.locales)).toBe("nl");
  });

  it("canonicalizes prefixes while preserving query strings and fragments", () => {
    expect(localizeHref("/en/cart?step=2#pay", "nl", options)).toBe("/nl/cart?step=2#pay");
    expect(localizeHref("/nl/cart?step=2#pay", "en", options)).toBe("/cart?step=2#pay");
    const resolution = resolveLocaleRequest(new Request("https://example.test/cart?step=2", { headers: { cookie: "copytranslater-locale=nl" } }), options);
    expect(resolution.redirect).toBe("/nl/cart?step=2");
  });

  it("does not rewrite excluded internal routes", () => {
    const resolution = resolveLocaleRequest(new Request("https://example.test/api/orders", { headers: { cookie: "copytranslater-locale=nl" } }), options);
    expect(resolution.redirect).toBeUndefined();
    expect(localizeHref("/assets/app.js", "nl", options)).toBe("/assets/app.js");
  });
});

describe("request-scoped namespace state", () => {
  it("isolates concurrent locales and caches each namespace", async () => {
    const calls: string[] = [];
    const load = async (locale: "en" | "nl", namespace: "common") => {
      calls.push(`${locale}:${namespace}`);
      return { locale };
    };
    const english = createI18nRequest({ locale: "en" as const, load });
    const dutch = createI18nRequest({ locale: "nl" as const, load });
    const [enOne, enTwo, nl] = await Promise.all([english.get("common"), english.get("common"), dutch.get("common")]);
    expect(enOne).toBe(enTwo);
    expect(enOne.locale).toBe("en");
    expect(nl.locale).toBe("nl");
    expect(calls).toEqual(["en:common", "nl:common"]);
  });

  it("hydrates preloaded namespaces without a second load", async () => {
    let calls = 0;
    const state = { locale: "nl" as const, namespaces: ["common" as const] };
    const request = await hydrateI18nState(state, async () => ({ value: ++calls }));
    expect((await request.get("common")).value).toBe(1);
    expect(calls).toBe(1);
    expect(request.dehydrate()).toEqual(state);
  });
});
