// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerVisibleMessage } from "../src/instrumentation.js";
import { mountCopyTranslaterOverlay } from "../src/overlay.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
describe("development overlay", () => {
  it("selects a registered element and saves an edited message", async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({
        ref: { locale: "nl", namespace: "checkout", id: "completePurchase" },
        state: "current",
        sourceFingerprint: "sha256:source",
        sourceFunction: "() => \"Complete your purchase\"",
        targetFunction: "() => \"Rond je aankoop af\"",
      }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ changed: true }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const message = document.createElement("button");
    message.textContent = "Rond je aankoop af";
    document.body.append(message);
    registerVisibleMessage(message, {
      ref: { locale: "nl", namespace: "checkout", id: "completePurchase" },
      source: "Complete your purchase",
      target: "Rond je aankoop af",
      state: "current",
    });
    const unmount = mountCopyTranslaterOverlay();
    const host = document.querySelector("copytranslater-overlay")!;
    const root = host.shadowRoot!;
    (root.querySelector("#launcher") as HTMLButtonElement).click();
    message.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect((root.querySelector("#editor") as HTMLDialogElement).open).toBe(true));
    const editor = root.querySelector("#target-function") as HTMLTextAreaElement;
    editor.value = "() => \"Afrekenen\"";
    (root.querySelector("#save-review") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ action: "update", review: true, functionText: "() => \"Afrekenen\"" });
    unmount();
  });
});
