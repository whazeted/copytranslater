import { setLocale } from "@copytranslater/runtime";
import { exampleHeadline } from "../i18n/messages/en/common.js";
import { loadMessages, type ExampleLocale } from "../i18n/loaders.js";

function required<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Example shell is missing ${selector}`);
  return element;
}

const output = required<HTMLElement>("#messages");
const localeSelect = required<HTMLSelectElement>("#locale");

async function render(locale: ExampleLocale): Promise<void> {
  setLocale(locale);
  const messages = await loadMessages(locale, "checkout");
  output.replaceChildren(
    Object.assign(document.createElement("p"), { textContent: messages.basketItems({ count: 3 }) }),
    Object.assign(document.createElement("p"), { textContent: messages.orderTotal({ amount: 42.5 }) }),
    Object.assign(document.createElement("button"), { textContent: messages.completePurchase(), type: "button" }),
  );
  document.documentElement.lang = locale;
}

required<HTMLElement>("#source-message").textContent = exampleHeadline();
localeSelect.addEventListener("change", () => void render(localeSelect.value as ExampleLocale));
void render(localeSelect.value as ExampleLocale);
