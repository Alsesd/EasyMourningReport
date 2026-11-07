import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Slice rules (CLAUDE.md): platform/ and ui/ never import modules/ or app/; a module never imports another module
// and never imports app/. Modules reach the shell only through platform/ and ui/.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const importsIn = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

describe("frontend slice boundaries", () => {
  it("platform/ and ui/ do not import modules/ or app/", () => {
    const bad = ["src/platform", "src/ui"].flatMap((d) =>
      sources(d).flatMap((f) => importsIn(f).filter((i) => /^@\/(modules|app)\//.test(i)).map((i) => `${f} -> ${i}`)),
    );
    expect(bad).toEqual([]);
  });

  it("a module imports neither another module nor app/", () => {
    const bad = readdirSync("src/modules")
      .filter((m) => statSync(join("src/modules", m)).isDirectory())
      .flatMap((m) =>
        sources(join("src/modules", m)).flatMap((f) =>
          importsIn(f)
            .filter((i) => /^@\/app\//.test(i) || (/^@\/modules\//.test(i) && !i.startsWith(`@/modules/${m}/`) && i !== `@/modules/${m}`))
            .map((i) => `${f} -> ${i}`),
        ),
      );
    expect(bad).toEqual([]);
  });
});
