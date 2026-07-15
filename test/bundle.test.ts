import path from "node:path";
import type { OutputChunk, RollupOutput } from "rollup";
import { describe, expect, it } from "vitest";
import { build } from "vite";

function chunks(output: RollupOutput | RollupOutput[]): OutputChunk[] {
  const builds = Array.isArray(output) ? output : [output];
  return builds.flatMap((item) => item.output.filter((entry): entry is OutputChunk => entry.type === "chunk"));
}

describe("production bundling", () => {
  it("tree-shakes unused static message exports", async () => {
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: path.resolve("test/fixtures/static-entry.ts") },
      },
    }) as RollupOutput;
    const code = chunks(output).map((chunk) => chunk.code).join("\n");
    expect(code).toContain("Complete your purchase");
    expect(code).not.toContain("TREE_SHAKING_SENTINEL");
  });

  it("emits target locale namespaces as dynamic chunks", async () => {
    const output = await build({
      configFile: path.resolve("examples/tanstack-start-basic/vite.config.ts"),
      mode: "production",
      define: { "import.meta.env.DEV": "false" },
      logLevel: "silent",
      build: { write: false, minify: false },
    }) as RollupOutput;
    const built = chunks(output);
    const entry = built.find((chunk) => chunk.isEntry)!;
    expect(entry.dynamicImports.length).toBeGreaterThanOrEqual(2);
    expect(built.some((chunk) => chunk.code.includes("Rond je aankoop af"))).toBe(true);
    expect(built.some((chunk) => chunk.code.includes("Kauf abschließen"))).toBe(true);
    const productionCode = built.map((chunk) => chunk.code).join("\n");
    expect(productionCode).not.toContain("AUTHORING_SENTINEL");
    expect(productionCode).not.toContain("Edit localized message");
    expect(productionCode).not.toContain("/__copytranslater");
    expect(productionCode).not.toContain("typescript-modules");
    expect(productionCode).not.toContain("copytranslater-mcp-server");
  });
});
