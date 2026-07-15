import { createContext, createElement, useContext, useEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { registerVisibleMessage } from "./instrumentation.js";
import type { VisibleMessageRegistration } from "./types.js";

interface CopyTranslaterReactContext {
  enabled: boolean;
}

const Context = createContext<CopyTranslaterReactContext>({ enabled: false });

export function CopyTranslaterProvider(props: { enabled: boolean; children: ReactNode }): ReactElement {
  return <Context.Provider value={{ enabled: props.enabled }}>{props.children}</Context.Provider>;
}

export interface LocalizedProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  as?: keyof React.JSX.IntrinsicElements;
  children: ReactNode;
  message?: VisibleMessageRegistration;
}

export function Localized({ as = "span", children, message, ...attributes }: LocalizedProps): ReactElement {
  const { enabled } = useContext(Context);
  const element = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled || !message || !element.current) return;
    return registerVisibleMessage(element.current, message);
  }, [enabled, message]);
  const developmentAttributes = enabled && message
    ? { "data-copytranslater-message": `${message.ref.namespace}.${message.ref.id}` }
    : {};
  return createElement(as, { ...attributes, ...developmentAttributes, ref: element }, children);
}
