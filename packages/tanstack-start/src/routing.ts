import type { LocaleResolution, LocaleRoutingOptions, LocaleStrategy } from "./types.js";

const defaultExclusions = ["/api", "/rpc", "/_", "/assets", "/favicon.ico"] as const;

function normalizedPathname(pathname: string): string {
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withSlash.replace(/\/{2,}/g, "/");
}

function isExcluded(pathname: string, exclusions: readonly (string | RegExp)[]): boolean {
  return exclusions.some((entry) => typeof entry === "string"
    ? pathname === entry || pathname.startsWith(`${entry}/`)
    : entry.test(pathname));
}

function localeMatch<Locale extends string>(candidate: string | undefined, locales: readonly Locale[]): Locale | undefined {
  if (!candidate) return undefined;
  const normalized = candidate.toLowerCase();
  return locales.find((locale) => locale.toLowerCase() === normalized)
    ?? locales.find((locale) => normalized.startsWith(`${locale.toLowerCase()}-`) || locale.toLowerCase().startsWith(`${normalized}-`));
}

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

export function parseAcceptLanguage<Locale extends string>(header: string | null, locales: readonly Locale[]): Locale | undefined {
  if (!header) return undefined;
  const candidates = header.split(",").map((entry, index) => {
    const [tag = "", ...parameters] = entry.trim().split(";");
    const qualityText = parameters.find((parameter) => parameter.trim().startsWith("q="))?.split("=")[1];
    const quality = qualityText === undefined ? 1 : Number(qualityText);
    return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
  }).filter((candidate) => candidate.quality > 0 && candidate.tag !== "*")
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const candidate of candidates) {
    const match = localeMatch(candidate.tag, locales);
    if (match) return match;
  }
  return undefined;
}

function splitLocale<Locale extends string>(pathname: string, locales: readonly Locale[]): { locale?: Locale; pathname: string } {
  const normalized = normalizedPathname(pathname);
  const segments = normalized.split("/");
  const locale = localeMatch(segments[1], locales);
  if (!locale) return { pathname: normalized };
  const rest = `/${segments.slice(2).join("/")}`;
  return { locale, pathname: rest === "/" ? "/" : rest.replace(/\/$/, "") };
}

export function localizeHref<Locale extends string>(
  href: string,
  locale: Locale,
  options: LocaleRoutingOptions<Locale>,
): string {
  const url = new URL(href, "https://copytranslater.local");
  if (isExcluded(url.pathname, options.exclude ?? defaultExclusions)) return `${url.pathname}${url.search}${url.hash}`;
  const stripped = splitLocale(url.pathname, options.locales).pathname;
  const prefix = options.prefix ?? "all-except-source";
  const shouldPrefix = prefix === "all" || locale !== options.sourceLocale;
  const pathname = shouldPrefix ? `/${locale}${stripped === "/" ? "" : stripped}` : stripped;
  return `${pathname || "/"}${url.search}${url.hash}`;
}

function strategyLocale<Locale extends string>(
  strategy: LocaleStrategy,
  request: Request,
  urlLocale: Locale | undefined,
  options: LocaleRoutingOptions<Locale>,
): Locale | undefined {
  if (strategy === "url") return urlLocale;
  if (strategy === "cookie") return localeMatch(parseCookie(request.headers.get("cookie"), options.cookie ?? "copytranslater-locale"), options.locales);
  if (strategy === "acceptLanguage") return parseAcceptLanguage(request.headers.get("accept-language"), options.locales);
  return options.sourceLocale;
}

export function resolveLocaleRequest<Locale extends string>(
  request: Request,
  options: LocaleRoutingOptions<Locale>,
): LocaleResolution<Locale> {
  const url = new URL(request.url);
  const excluded = isExcluded(url.pathname, options.exclude ?? defaultExclusions);
  const split = splitLocale(url.pathname, options.locales);
  const strategies = options.strategy ?? ["url", "cookie", "acceptLanguage", "sourceLocale"];
  let locale = options.sourceLocale;
  let source: LocaleStrategy = "sourceLocale";
  for (const strategy of strategies) {
    const candidate = strategyLocale(strategy, request, split.locale, options);
    if (candidate) { locale = candidate; source = strategy; break; }
  }
  const canonical = localizeHref(`${url.pathname}${url.search}${url.hash}`, locale, options);
  const current = `${url.pathname}${url.search}${url.hash}`;
  const result: LocaleResolution<Locale> = { locale, pathname: split.pathname, source };
  if (!excluded && canonical !== current) result.redirect = canonical;
  return result;
}

export function localeRedirect<Locale extends string>(
  href: string,
  locale: Locale,
  options: LocaleRoutingOptions<Locale>,
  status: 301 | 302 | 307 | 308 = 307,
): Response {
  return new Response(null, { status, headers: { location: localizeHref(href, locale, options) } });
}
