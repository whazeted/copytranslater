import type * as Source from "../en/checkout.js";
import { formatNumber, plural } from "@copytranslater/runtime";
export type CopyTranslaterFormat = 1;
export interface BasedOn {
    basketItems: "sha256:c15574dc93bcf6964063bf1e48597cb769cbacad321faa919670add2f69fdf86";
    completePurchase: "sha256:764572e1b36f40d7675aff16ab22e5f007a416d4efc998222ccc7a18249bfac2";
    orderTotal: "sha256:76f430af4b3bac16905119bb411f46ce841dcddad67b2bed6c9ef146fcaef32d";
    unusedStaticMessage: "sha256:b9fdef7cbe36752b46f5569303185440d571ad3ba0b26de71fa8954b4be3b4a3";
}
export interface Reviewed {
    completePurchase: "sha256:764572e1b36f40d7675aff16ab22e5f007a416d4efc998222ccc7a18249bfac2";
}
export const completePurchase = (() => "Kauf abschließen") satisfies typeof Source.completePurchase;
export const basketItems = (({ count }) => plural(count, {
    one: () => "1 Artikel",
    other: () => `${count} Artikel`,
})) satisfies typeof Source.basketItems;
export const orderTotal = (({ amount }) => `Summe: ${formatNumber(amount, { style: "currency", currency: "EUR" })}`) satisfies typeof Source.orderTotal;
export const unusedStaticMessage = (() => "UNBENUTZT") satisfies typeof Source.unusedStaticMessage;
