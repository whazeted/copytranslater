import { getVisibleMessage, getVisibleMessageElement } from "./instrumentation.js";
import type { VisibleMessageRegistration } from "./types.js";

interface BridgeMessage {
  ref: VisibleMessageRegistration["ref"];
  state: VisibleMessageRegistration["state"];
  sourceFingerprint: string;
  basedOn?: string;
  reviewed?: string;
  sourceFunction: string;
  targetFunction?: string;
  context?: Record<string, string | number | boolean>;
  isSourceLocale?: boolean;
}

export interface CopyTranslaterOverlayOptions {
  endpoint?: string;
}

function element<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const found = root.querySelector<ElementType>(selector);
  if (!found) throw new Error(`CopyTranslater overlay is missing ${selector}`);
  return found;
}

function template(): string {
  return `
    <style>
      :host { all: initial; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      button, textarea { font: inherit; }
      #launcher { position: fixed; z-index: 2147483646; right: 1rem; bottom: 1rem; border: 1px solid #9ce8c8; border-radius: 999px; padding: .7rem 1rem; background: #10251e; color: #e8fff6; box-shadow: 0 .5rem 2rem #0008; cursor: pointer; }
      #launcher[aria-pressed="true"] { background: #78e0b4; color: #092017; }
      #highlight { display: none; position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #6ff2bb; border-radius: .35rem; background: #6ff2bb26; box-shadow: 0 0 0 2px #10251ecc; }
      dialog { width: min(54rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); box-sizing: border-box; border: 1px solid #416b5a; border-radius: 1rem; padding: 0; background: #10251e; color: #e8fff6; box-shadow: 0 1.5rem 5rem #000b; }
      dialog::backdrop { background: #06100ccc; backdrop-filter: blur(3px); }
      header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.5rem; border-bottom: 1px solid #315246; }
      h2 { margin: 0; font-size: 1.1rem; }
      #message-ref { margin: .3rem 0 0; color: #a9cabe; font: .8rem ui-monospace, monospace; }
      #close { border: 0; border-radius: .4rem; padding: .35rem .6rem; background: transparent; color: inherit; cursor: pointer; }
      main { overflow: auto; padding: 1.25rem 1.5rem; }
      .summary { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
      #state { border-radius: 999px; padding: .2rem .55rem; background: #315246; font-size: .75rem; text-transform: uppercase; }
      #description { color: #bcd2ca; }
      .values, .functions { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      label { display: grid; gap: .4rem; color: #cde2da; font-size: .8rem; }
      textarea { box-sizing: border-box; width: 100%; min-height: 5rem; resize: vertical; border: 1px solid #416b5a; border-radius: .55rem; padding: .7rem; background: #0a1a15; color: #f1fff9; line-height: 1.45; }
      textarea[readonly] { color: #bcd2ca; }
      textarea:user-invalid, textarea[aria-invalid="true"] { border-color: #ff8e8e; }
      .functions { margin-top: 1rem; }
      .functions textarea { min-height: 9rem; font: .78rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
      #parameters { display: flex; flex-wrap: wrap; gap: .35rem; min-height: 1.5rem; margin: 1rem 0; }
      #parameters span { border: 1px solid #416b5a; border-radius: 999px; padding: .2rem .5rem; color: #bcd2ca; font: .72rem ui-monospace, monospace; }
      footer { display: flex; flex-wrap: wrap; gap: .55rem; padding: 1rem 1.5rem 1.25rem; border-top: 1px solid #315246; }
      footer button, #preview-source { border: 1px solid #4d7867; border-radius: .5rem; padding: .55rem .75rem; background: #17372c; color: #e8fff6; cursor: pointer; }
      footer .primary { border-color: #78e0b4; background: #78e0b4; color: #092017; font-weight: 700; }
      button:focus-visible, textarea:focus-visible { outline: 3px solid #a6ffe0; outline-offset: 2px; }
      #feedback { min-height: 1.3rem; margin: .8rem 0 0; color: #a9cabe; }
      #error { min-height: 1.3rem; margin: .25rem 0 0; color: #ffadad; }
      @media (max-width: 650px) { .values, .functions { grid-template-columns: 1fr; } dialog { max-height: 100vh; } }
      @media (prefers-reduced-motion: reduce) { dialog { scroll-behavior: auto; } }
    </style>
    <button id="launcher" type="button" aria-pressed="false">Inspect messages</button>
    <div id="highlight" aria-hidden="true"></div>
    <dialog id="editor" aria-labelledby="editor-title">
      <header><div><h2 id="editor-title">Edit localized message</h2><p id="message-ref"></p></div><button id="close" type="button" aria-label="Close editor">✕</button></header>
      <main>
        <div class="summary"><span id="state"></span><span id="description"></span></div>
        <div class="values">
          <label>Rendered source<textarea id="source-value" readonly></textarea></label>
          <label>Rendered target<textarea id="target-value" readonly></textarea></label>
        </div>
        <div class="functions">
          <label>Source function<textarea id="source-function" spellcheck="false" required aria-errormessage="error"></textarea><button id="preview-source" type="button">Preview stale translations</button></label>
          <label>Target function<textarea id="target-function" spellcheck="false" required aria-errormessage="error"></textarea></label>
        </div>
        <div id="parameters" aria-label="Message parameters"></div>
        <p id="feedback" role="status" aria-live="polite"></p>
        <p id="error" role="alert"></p>
      </main>
      <footer>
        <button id="revert" type="button">Revert</button>
        <button id="copy-source" type="button">Copy source</button>
        <button id="acknowledge" type="button">Advance BasedOn</button>
        <button id="save-source" type="button">Save source</button>
        <button id="save" class="primary" type="button">Save target</button>
        <button id="save-review" class="primary" type="button">Save and review</button>
      </footer>
    </dialog>`;
}

export function mountCopyTranslaterOverlay(options: CopyTranslaterOverlayOptions = {}): () => void {
  const endpoint = options.endpoint ?? "/__copytranslater";
  const host = document.createElement("copytranslater-overlay");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = template();
  document.body.append(host);

  const launcher = element<HTMLButtonElement>(root, "#launcher");
  const highlight = element<HTMLElement>(root, "#highlight");
  const dialog = element<HTMLDialogElement>(root, "#editor");
  const messageRef = element<HTMLElement>(root, "#message-ref");
  const state = element<HTMLElement>(root, "#state");
  const description = element<HTMLElement>(root, "#description");
  const sourceValue = element<HTMLTextAreaElement>(root, "#source-value");
  const targetValue = element<HTMLTextAreaElement>(root, "#target-value");
  const sourceFunction = element<HTMLTextAreaElement>(root, "#source-function");
  const targetFunction = element<HTMLTextAreaElement>(root, "#target-function");
  const parameters = element<HTMLElement>(root, "#parameters");
  const feedback = element<HTMLElement>(root, "#feedback");
  const error = element<HTMLElement>(root, "#error");
  let inspecting = false;
  let selected: VisibleMessageRegistration | undefined;
  let details: BridgeMessage | undefined;

  const setInspecting = (value: boolean) => {
    inspecting = value;
    launcher.setAttribute("aria-pressed", String(value));
    launcher.textContent = value ? "Stop inspecting" : "Inspect messages";
    if (!value) highlight.style.display = "none";
    document.documentElement.style.cursor = value ? "crosshair" : "";
  };

  const showError = (message = "") => {
    error.textContent = message;
    for (const editor of [sourceFunction, targetFunction]) {
      if (message) editor.setAttribute("aria-invalid", "true");
      else editor.removeAttribute("aria-invalid");
    }
  };

  const callBridge = async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string; changed?: boolean; staleCount?: number };
    if (!response.ok) throw new Error(result.error ?? `Bridge request failed (${response.status})`);
    return result;
  };

  const body = (action: string, functionText?: string) => ({
    action,
    locale: selected!.ref.locale,
    namespace: selected!.ref.namespace,
    id: selected!.ref.id,
    expectedSourceFingerprint: details!.sourceFingerprint,
    functionText,
  });

  const load = async (registration: VisibleMessageRegistration) => {
    selected = registration;
    showError();
    feedback.textContent = "Loading message…";
    const query = new URLSearchParams({
      locale: registration.ref.locale,
      namespace: registration.ref.namespace,
      id: registration.ref.id,
    });
    const response = await fetch(`${endpoint}?${query}`, { headers: { accept: "application/json" } });
    const result = await response.json() as BridgeMessage & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Bridge request failed (${response.status})`);
    details = result;
    messageRef.textContent = `${registration.ref.locale}/${registration.ref.namespace}.${registration.ref.id}`;
    state.textContent = result.state;
    description.textContent = registration.description ?? "";
    sourceValue.value = registration.source;
    targetValue.value = registration.target;
    sourceFunction.value = result.sourceFunction;
    targetFunction.value = result.targetFunction ?? result.sourceFunction;
    targetFunction.disabled = result.isSourceLocale === true;
    for (const selector of ["#save", "#save-review", "#acknowledge"] as const) {
      element<HTMLButtonElement>(root, selector).disabled = result.isSourceLocale === true;
    }
    parameters.replaceChildren(...Object.entries(registration.parameters ?? {}).map(([key, value]) => {
      const chip = document.createElement("span");
      chip.textContent = `${key}: ${String(value)}`;
      return chip;
    }));
    feedback.textContent = registration.maxLength === undefined ? "" : `Recommended maximum: ${registration.maxLength} characters.`;
    if (!dialog.open) dialog.showModal();
    targetFunction.focus();
  };

  const saveTarget = async (review: boolean) => {
    if (!selected || !details) return;
    showError();
    if (!targetFunction.reportValidity()) return;
    feedback.textContent = review ? "Saving and reviewing…" : "Saving…";
    await callBridge({ ...body("update", targetFunction.value), review });
    feedback.textContent = "Saved. Reloading…";
  };

  launcher.addEventListener("click", () => setInspecting(!inspecting));
  element<HTMLButtonElement>(root, "#close").addEventListener("click", () => dialog.close());
  element<HTMLButtonElement>(root, "#revert").addEventListener("click", () => {
    if (!details) return;
    sourceFunction.value = details.sourceFunction;
    targetFunction.value = details.targetFunction ?? details.sourceFunction;
    showError();
    feedback.textContent = "Changes reverted locally.";
  });
  element<HTMLButtonElement>(root, "#copy-source").addEventListener("click", () => {
    if (!details) return;
    targetFunction.value = details.sourceFunction;
    feedback.textContent = "Source function copied to the target editor.";
  });
  element<HTMLButtonElement>(root, "#acknowledge").addEventListener("click", () => {
    if (!details) return;
    void callBridge(body("acknowledge")).catch((cause: unknown) => showError((cause as Error).message));
  });
  element<HTMLButtonElement>(root, "#preview-source").addEventListener("click", () => {
    if (!details || !sourceFunction.reportValidity()) return;
    void callBridge(body("preview-source", sourceFunction.value))
      .then((result) => { feedback.textContent = `${result.staleCount ?? 0} translation(s) would become stale.`; })
      .catch((cause: unknown) => showError((cause as Error).message));
  });
  element<HTMLButtonElement>(root, "#save-source").addEventListener("click", () => {
    if (!details || !sourceFunction.reportValidity()) return;
    void callBridge(body("update-source", sourceFunction.value)).catch((cause: unknown) => showError((cause as Error).message));
  });
  element<HTMLButtonElement>(root, "#save").addEventListener("click", () => void saveTarget(false).catch((cause: unknown) => showError((cause as Error).message)));
  element<HTMLButtonElement>(root, "#save-review").addEventListener("click", () => void saveTarget(true).catch((cause: unknown) => showError((cause as Error).message)));

  const pointerMove = (event: PointerEvent) => {
    if (!inspecting) return;
    const target = event.target instanceof Element ? getVisibleMessageElement(event.target) : undefined;
    if (!target) { highlight.style.display = "none"; return; }
    const bounds = target.getBoundingClientRect();
    Object.assign(highlight.style, { display: "block", left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  };
  const click = (event: MouseEvent) => {
    if (!inspecting || !(event.target instanceof Element)) return;
    const registration = getVisibleMessage(event.target);
    if (!registration) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setInspecting(false);
    void load(registration).catch((cause: unknown) => showError((cause as Error).message));
  };
  document.addEventListener("pointermove", pointerMove, true);
  document.addEventListener("click", click, true);

  return () => {
    document.removeEventListener("pointermove", pointerMove, true);
    document.removeEventListener("click", click, true);
    document.documentElement.style.cursor = "";
    host.remove();
  };
}
