import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Ch 7 access boundary, enforced rather than documented: Public Knowledge
// grounds Planning and Validation ONLY — Research must have no path to the
// corpus (§7.2, Decision Log). In a TypeScript monorepo the dependency edge
// is the enforceable seam, so this test walks every workspace and fails the
// suite if anything outside the allowlist depends on or imports this package.
// Adding "@tethr/public-knowledge" to packages/research would fail here.

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PACKAGE_NAME = "@tethr/public-knowledge";

// Ch 7: exactly two consumers, ever. Extending this list is a product change
// that needs a handbook amendment (Constitution I), not a code review nit.
const ALLOWED_CONSUMERS = new Set(["@tethr/planning", "@tethr/validation"]);

type Workspace = { name: string; dir: string; dependencies: string[] };

function workspaces(): Workspace[] {
  const found: Workspace[] = [];
  for (const group of ["packages", "apps"]) {
    for (const entry of readdirSync(join(REPO_ROOT, group))) {
      const dir = join(REPO_ROOT, group, entry);
      let manifest: {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      } catch {
        continue;
      }
      found.push({
        name: manifest.name ?? entry,
        dir,
        dependencies: [
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
        ],
      });
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) files.push(path);
    }
  };
  walk(dir);
  return files;
}

describe("Ch 7 access boundary", () => {
  it("only Planning and Validation may depend on the Public Knowledge package", () => {
    const violations = workspaces()
      .filter((ws) => ws.name !== PACKAGE_NAME && !ALLOWED_CONSUMERS.has(ws.name))
      .filter((ws) => ws.dependencies.includes(PACKAGE_NAME))
      .map((ws) => ws.name);
    expect(violations, `${violations.join(", ")} must not depend on ${PACKAGE_NAME}`).toEqual([]);
  });

  it("no source outside the allowlist imports the grounding module — including Research", () => {
    const importPattern = /@tethr\/public-knowledge|from\s+["'][^"']*\/public-knowledge\//;
    const violations: string[] = [];
    for (const ws of workspaces()) {
      if (ws.name === PACKAGE_NAME || ALLOWED_CONSUMERS.has(ws.name)) continue;
      for (const file of sourceFiles(ws.dir)) {
        if (importPattern.test(readFileSync(file, "utf8"))) violations.push(file);
      }
    }
    expect(violations, `no path to the corpus outside Planning/Validation (§7.2)`).toEqual([]);
  });

  it("no raw-SQL bypass: nothing outside the allowlist mentions rag_corpus at all", () => {
    // The import checks above are necessary but not sufficient: every package
    // already holds a db client, so raw sql`... from rag_corpus` would reach
    // the corpus without ever importing this package. Non-test sources of
    // every workspace outside the allowlist must not name the table. (Tests
    // may seed it — they prove grants and don't ship; .sql migrations are the
    // schema itself; scripts/ is operational tooling outside the product
    // boundary and is reviewed, not scanned.)
    const violations: string[] = [];
    for (const ws of workspaces()) {
      if (ws.name === PACKAGE_NAME || ALLOWED_CONSUMERS.has(ws.name)) continue;
      for (const file of sourceFiles(ws.dir)) {
        if (file.endsWith(".test.ts")) continue;
        if (/rag_corpus/.test(readFileSync(file, "utf8").replace(/^\s*(--|\/\/).*$/gm, ""))) {
          violations.push(file);
        }
      }
    }
    expect(violations, "raw SQL against rag_corpus outside Planning/Validation (§7.2)").toEqual([]);
  });
});
