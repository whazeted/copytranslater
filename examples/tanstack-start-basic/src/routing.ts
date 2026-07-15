export const routing = {
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  prefix: "all-except-source",
  strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
} as const;
