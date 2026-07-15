import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { hydrateCheckout } from "../examples/tanstack-start-basic/src/checkout-data.js";
import { loadMessages } from "../examples/tanstack-start-basic/i18n/loaders.js";

let server: ViteDevServer;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    configFile: path.resolve("examples/tanstack-start-basic/vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("TanStack Start did not expose a TCP address");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
});

describe("TanStack Start example", () => {
  it("renders localized namespaces during real SSR requests without cross-request locale leaks", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, async () => {
      const [dutch, german] = await Promise.all([
        fetch(`${origin}/nl`).then((response) => response.text()),
        fetch(`${origin}/de`).then((response) => response.text()),
      ]);
      return { dutch, german };
    }));

    for (const { dutch, german } of responses) {
      expect(dutch).toContain("data-copytranslater-ssr-locale=\"nl\"");
      expect(dutch).toContain("data-copytranslater-hydration=\"checkout\"");
      expect(dutch).toContain("Rond je aankoop af");
      expect(dutch).toContain("Totaal:");
      expect(dutch).not.toContain("Kauf abschließen");

      expect(german).toContain("data-copytranslater-ssr-locale=\"de\"");
      expect(german).toContain("data-copytranslater-hydration=\"checkout\"");
      expect(german).toContain("Kauf abschließen");
      expect(german).toContain("Summe:");
      expect(german).not.toContain("Rond je aankoop af");
    }
  });

  it("runs locale middleware before routing and preserves the query in canonical redirects", async () => {
    const response = await fetch(`${origin}/?step=2`, {
      headers: { "accept-language": "nl-NL,nl;q=.9" },
      redirect: "manual",
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/nl?step=2");
    expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");

    const localizedPage = await fetch(`${origin}/nl?step=2`).then((result) => result.text());
    expect(localizedPage).toContain("href=\"/de?step=2\"");
    expect(localizedPage).toContain("href=\"/?step=2\"");
  });

  it("hydrates a serialized namespace once and reuses it for the first message read", async () => {
    let loads = 0;
    const load: typeof loadMessages = async (locale, namespace) => {
      loads += 1;
      return loadMessages(locale, namespace);
    };

    const messages = await hydrateCheckout({ locale: "nl", namespaces: ["checkout"] }, load);

    expect(messages.completePurchase).toBe("Rond je aankoop af");
    expect(loads).toBe(1);
  });

  it("keeps the development authoring bridge connected to SSR message references", async () => {
    const response = await fetch(`${origin}/__copytranslater?locale=nl&namespace=checkout&id=completePurchase`);
    const details = await response.json() as { targetFunction: string; state: string };

    expect(response.status).toBe(200);
    expect(details.targetFunction).toContain("Rond je aankoop af");
    expect(details.state).toBe("reviewed");
  });
});
