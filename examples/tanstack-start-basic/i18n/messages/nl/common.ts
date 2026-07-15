import type * as Source from "../en/common.js";
export type CopyTranslaterFormat = 1;
export interface BasedOn {
    exampleHeadline: "sha256:addfb92aad412638f43955cd489803c9da4c41b7d286323367c18ea862c6a54a";
}
export interface Reviewed {
}
export const exampleHeadline = (() => "Een statisch geïmporteerd bronbericht") satisfies typeof Source.exampleHeadline;
