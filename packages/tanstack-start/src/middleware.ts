import { createMiddleware } from "@tanstack/react-start";
import { resolveLocaleRequest } from "./routing.js";
import type { LocaleResolution, LocaleRoutingOptions } from "./types.js";

export interface CopyTranslaterRequestContext<Locale extends string = string> {
  copytranslater: LocaleResolution<Locale>;
}

export function createCopyTranslaterMiddleware<Locale extends string>(options: LocaleRoutingOptions<Locale>) {
  return createMiddleware().server(async ({ next, request }) => {
    const resolution = resolveLocaleRequest(request, options);
    if (resolution.redirect) {
      return new Response(null, {
        status: 307,
        headers: { location: resolution.redirect, vary: "Cookie, Accept-Language" },
      });
    }
    return next({ context: { copytranslater: resolution } });
  });
}
