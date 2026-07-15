import { defineI18n } from "copytranslater";

export default defineI18n({
  sourceLocale: "en",
  locales: ["en", "nl", "de"],
  messages: "./i18n/messages",
  staleTranslations: "error",
  missingTranslations: "error",
});
