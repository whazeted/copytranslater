import type { VisibleMessageRegistration } from "./types.js";

const registrations = new WeakMap<Element, VisibleMessageRegistration>();

export function registerVisibleMessage(element: Element, registration: VisibleMessageRegistration): () => void {
  registrations.set(element, registration);
  element.setAttribute("data-copytranslater-message", `${registration.ref.namespace}.${registration.ref.id}`);
  return () => {
    registrations.delete(element);
    element.removeAttribute("data-copytranslater-message");
  };
}

export function getVisibleMessage(element: Element | null): VisibleMessageRegistration | undefined {
  let current = element;
  while (current) {
    const registration = registrations.get(current);
    if (registration) return registration;
    current = current.parentElement;
  }
  return undefined;
}

export function getVisibleMessageElement(element: Element | null): Element | undefined {
  let current = element;
  while (current) {
    if (registrations.has(current)) return current;
    current = current.parentElement;
  }
  return undefined;
}
