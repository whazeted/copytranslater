import { describe, expect, it } from "vitest";
import { parseModuleText } from "../src/parser.js";

const compact = `
  import { plural } from "@copytranslater/runtime";
  export type CopyTranslaterFormat = 1;
  export interface SourceRevisions {}
  export const items=({count}:{count:number})=>plural(count,{one:()=>"one",other:()=>\`${"${count}"} items\`});
`;

describe("native message parser", () => {
  it("creates formatting-independent semantic fingerprints", () => {
    const formatted = `
      import { plural } from "@copytranslater/runtime";
      export const items = ({ count }: { count: number }) =>
        plural(count, {
          other: () => \`${"${count}"} items\`,
          one: () => "one",
        });
    `;
    const left = parseModuleText("left.ts", compact).messages.get("items")!;
    const right = parseModuleText("right.ts", formatted).messages.get("items")!;
    expect(left.semanticFingerprint).toBe(right.semanticFingerprint);
    expect(left.contractFingerprint).toBe(right.contractFingerprint);
  });

  it("makes wording changes semantic but not contractual", () => {
    const left = parseModuleText("left.ts", compact).messages.get("items")!;
    const changed = parseModuleText("changed.ts", compact.replace("} items", "} products")).messages.get("items")!;
    expect(left.semanticFingerprint).not.toBe(changed.semanticFingerprint);
    expect(left.contractFingerprint).toBe(changed.contractFingerprint);
  });

  it.each([
    "export const bad = () => fetch('/api')",
    "export const bad = () => user.name",
    "export const bad = () => { const x = 'side effect'; return x; }",
  ])("rejects unsupported grammar: %s", (statement) => {
    expect(() => parseModuleText("bad.ts", statement)).toThrow(/supported|only|Unknown/);
  });

  it("rejects invalid plural variants", () => {
    expect(() => parseModuleText("bad.ts", "export const bad = ({ n }: { n: number }) => plural(n, { singular: () => 'x', other: () => 'y' })"))
      .toThrow(/Invalid plural category/);
  });
});
