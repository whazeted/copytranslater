import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { localizeHref, type VisibleMessageState } from "@copytranslater/tanstack-start";
import { CopyTranslaterProvider, Localized } from "@copytranslater/tanstack-start/react";
import { exampleHeadline } from "../../i18n/messages/en/common.js";
import { getCheckoutRouteData, hydrateCheckout } from "../checkout-data.js";
import { routing } from "../routing.js";

export const Route = createFileRoute("/{-$locale}")({
  loader: () => getCheckoutRouteData(),
  component: CheckoutPage,
});

function stateFor(id: string): VisibleMessageState {
  return id === "completePurchase" ? "reviewed" : "current";
}

function CheckoutPage() {
  const data = Route.useLoaderData();
  const location = useLocation();
  const [messages, setMessages] = useState(data.target);

  useEffect(() => {
    let active = true;
    void hydrateCheckout(data.hydration).then((hydrated) => {
      if (active) setMessages(hydrated);
    });
    return () => { active = false; };
  }, [data.hydration]);

  const links = useMemo(() => routing.locales.map((locale) => ({
    locale,
    href: localizeHref(location.publicHref, locale, routing),
  })), [location.publicHref]);

  return (
    <CopyTranslaterProvider enabled={import.meta.env.DEV}>
      <main
        className="shell"
        lang={data.locale}
        data-copytranslater-ssr-locale={data.locale}
        data-copytranslater-hydration={data.hydration.namespaces.join(",")}
      >
        <p className="eyebrow">Static import · {exampleHeadline()}</p>
        <h1>Native messages, rendered on the server</h1>
        <nav aria-label="Language">
          {links.map((link) => <a
            key={link.locale}
            href={link.href}
            aria-current={link.locale === data.locale ? "page" : undefined}
          >{link.locale.toUpperCase()}</a>)}
        </nav>
        <section className="checkout" aria-label="Checkout example">
          <Localized message={import.meta.env.DEV ? {
            ref: { locale: data.locale, namespace: "checkout", id: "basketItems" },
            source: data.source.basketItems,
            target: messages.basketItems,
            state: stateFor("basketItems"),
            parameters: { count: 3 },
            sourceLocation: "i18n/messages/en/checkout.ts",
          } : undefined}>{messages.basketItems}</Localized>
          <Localized message={import.meta.env.DEV ? {
            ref: { locale: data.locale, namespace: "checkout", id: "orderTotal" },
            source: data.source.orderTotal,
            target: messages.orderTotal,
            state: stateFor("orderTotal"),
            parameters: { amount: 42.5 },
            sourceLocation: "i18n/messages/en/checkout.ts",
          } : undefined}>{messages.orderTotal}</Localized>
          <Localized
            as="button"
            type="button"
            message={import.meta.env.DEV ? {
              ref: { locale: data.locale, namespace: "checkout", id: "completePurchase" },
              source: data.source.completePurchase,
              target: messages.completePurchase,
              state: stateFor("completePurchase"),
              description: "Primary checkout submit button — AUTHORING_SENTINEL",
              maxLength: 40,
              sourceLocation: "i18n/messages/en/checkout.ts",
            } : undefined}
          >{messages.completePurchase}</Localized>
        </section>
        <p className="hint">In development, choose <strong>Inspect messages</strong> and click any checkout message.</p>
      </main>
    </CopyTranslaterProvider>
  );
}

if (import.meta.env.DEV && typeof document !== "undefined") {
  void import("@copytranslater/tanstack-start/overlay")
    .then(({ mountCopyTranslaterOverlay }) => mountCopyTranslaterOverlay());
}
