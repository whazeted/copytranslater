import { createStart } from "@tanstack/react-start";
import { createCopyTranslaterMiddleware } from "@copytranslater/tanstack-start/middleware";
import { routing } from "./routing.js";

const i18nMiddleware = createCopyTranslaterMiddleware(routing);

export const startInstance = createStart(() => ({
  requestMiddleware: [i18nMiddleware],
}));
