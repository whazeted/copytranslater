import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { setLocale } from "@copytranslater/runtime";
import { localizeHref, resolveLocaleRequest, type VisibleMessageState } from "@copytranslater/tanstack-start";
import { CopyTranslaterProvider, Localized } from "@copytranslater/tanstack-start/react";
import { exampleHeadline } from "../i18n/messages/en/common.js";
import { loadMessages, type ExampleLocale } from "../i18n/loaders.js";
import "./styles.css";

const routing = {
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  prefix: "all-except-source",
  strategy: ["url", "cookie", "acceptLanguage", "sourceLocale"],
} as const;

const languageHeader = navigator.languages.join(",");
const resolution = resolveLocaleRequest(new Request(location.href, {
  headers: { cookie: document.cookie, "accept-language": languageHeader },
}), routing);
if (resolution.redirect) history.replaceState(null, "", resolution.redirect);

type Checkout = Awaited<ReturnType<typeof loadMessages>>;

function stateFor(id: string): VisibleMessageState {
  return id === "completePurchase" ? "reviewed" : "current";
}

function App() {
  const [locale, setActiveLocale] = useState<ExampleLocale>(resolution.locale);
  const [messages, setMessages] = useState<Checkout>();
  const [sourceMessages, setSourceMessages] = useState<Checkout>();
  useEffect(() => {
    setLocale(locale);
    document.cookie = `copytranslater-locale=${locale}; Path=/; SameSite=Lax`;
    void loadMessages(locale, "checkout").then(setMessages);
    if (import.meta.env.DEV) void loadMessages("en", "checkout").then(setSourceMessages);
  }, [locale]);
  const links = useMemo(() => routing.locales.map((target) => ({
    locale: target,
    href: localizeHref(`${location.pathname}${location.search}${location.hash}`, target, routing),
  })), []);
  if (!messages) return <main className="shell"><p role="status">Loading messages…</p></main>;
  const count = 3;
  const amount = 42.5;
  return (
    <CopyTranslaterProvider enabled={import.meta.env.DEV}>
      <main className="shell">
        <p className="eyebrow">Static import · {exampleHeadline()}</p>
        <h1>Native messages, edited in context</h1>
        <nav aria-label="Language">
          {links.map((link) => <a
            key={link.locale}
            href={link.href}
            aria-current={link.locale === locale ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              history.pushState(null, "", link.href);
              setActiveLocale(link.locale);
            }}
          >{link.locale.toUpperCase()}</a>)}
        </nav>
        <section className="checkout" aria-label="Checkout example">
          <Localized message={import.meta.env.DEV ? {
            ref: { locale, namespace: "checkout", id: "basketItems" },
            source: sourceMessages?.basketItems({ count }) ?? "",
            target: messages.basketItems({ count }),
            state: stateFor("basketItems"),
            parameters: { count },
            sourceLocation: "i18n/messages/en/checkout.ts",
          } : undefined}>{messages.basketItems({ count })}</Localized>
          <Localized message={import.meta.env.DEV ? {
            ref: { locale, namespace: "checkout", id: "orderTotal" },
            source: sourceMessages?.orderTotal({ amount }) ?? "",
            target: messages.orderTotal({ amount }),
            state: stateFor("orderTotal"),
            parameters: { amount },
            sourceLocation: "i18n/messages/en/checkout.ts",
          } : undefined}>{messages.orderTotal({ amount })}</Localized>
          <Localized
            as="button"
            type="button"
            message={import.meta.env.DEV ? {
              ref: { locale, namespace: "checkout", id: "completePurchase" },
              source: sourceMessages?.completePurchase() ?? "",
              target: messages.completePurchase(),
              state: stateFor("completePurchase"),
              description: "Primary checkout submit button — AUTHORING_SENTINEL",
              maxLength: 40,
              sourceLocation: "i18n/messages/en/checkout.ts",
            } : undefined}
          >{messages.completePurchase()}</Localized>
        </section>
        <p className="hint">In development, choose <strong>Inspect messages</strong> and click any checkout message.</p>
      </main>
    </CopyTranslaterProvider>
  );
}

createRoot(document.querySelector("#root")!).render(<App />);

if (import.meta.env.DEV) {
  void import("@copytranslater/tanstack-start/overlay").then(({ mountCopyTranslaterOverlay }) => mountCopyTranslaterOverlay());
}
