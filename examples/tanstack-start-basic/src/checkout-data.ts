import { getLocale, setLocale } from "@copytranslater/runtime";
import { createI18nRequest, hydrateI18nState, preloadRouteNamespaces, type I18nHydrationState } from "@copytranslater/tanstack-start";
import { createServerFn } from "@tanstack/react-start";
import { loadMessages, type ExampleLocale } from "../i18n/loaders.js";

type CheckoutMessages = Awaited<ReturnType<typeof loadMessages>>;

export interface RenderedCheckout {
  basketItems: string;
  orderTotal: string;
  completePurchase: string;
}

function renderWithLocale(locale: ExampleLocale, messages: CheckoutMessages): RenderedCheckout {
  const previousLocale = getLocale();
  setLocale(locale);
  try {
    return {
      basketItems: messages.basketItems({ count: 3 }),
      orderTotal: messages.orderTotal({ amount: 42.5 }),
      completePurchase: messages.completePurchase(),
    };
  } finally {
    setLocale(previousLocale);
  }
}

export async function hydrateCheckout(
  state: I18nHydrationState<ExampleLocale, "checkout">,
  load = loadMessages,
): Promise<RenderedCheckout> {
  const request = await hydrateI18nState(state, load);
  const messages = await request.get("checkout");
  return renderWithLocale(state.locale, messages);
}

export const getCheckoutRouteData = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const localeValue: unknown = context.copytranslater.locale;
  if (!isExampleLocale(localeValue)) throw new Error("Locale middleware returned an unsupported locale");
  const locale = localeValue;
  const request = createI18nRequest({ locale, load: loadMessages });
  const hydration = await preloadRouteNamespaces(request, ["checkout"]);
  const [messages, sourceMessages] = await Promise.all([
    request.get("checkout"),
    loadMessages(routingSourceLocale, "checkout"),
  ]);

  return {
    locale,
    hydration,
    target: renderWithLocale(locale, messages),
    source: renderWithLocale(routingSourceLocale, sourceMessages),
  };
});

const routingSourceLocale = "en" satisfies ExampleLocale;

function isExampleLocale(value: unknown): value is ExampleLocale {
  return value === "en" || value === "nl" || value === "de";
}
