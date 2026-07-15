import type * as Source from "./messages/en/checkout.js";

// This assertion proves TypeScript rejects a translation with an incompatible parameter type.
// @ts-expect-error string is incompatible with the source message's numeric count
const invalidBasket = (({ count }: { count: string }) => count) satisfies typeof Source.basketItems;
