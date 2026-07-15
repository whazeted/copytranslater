import { createNamespaceLoader } from "@copytranslater/runtime";

export const loadMessages = createNamespaceLoader({
  en: { checkout: () => import("./messages/en/checkout.js") },
  nl: { checkout: () => import("./messages/nl/checkout.js") },
  de: { checkout: () => import("./messages/de/checkout.js") },
});

export type ExampleLocale = "en" | "nl" | "de";
