import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `src/core/` is the code that ports to React Native untouched. That is only
 * true while it stays free of the platform, and "stays" is the hard part: a
 * single convenient `window.` or `@/lib` import is invisible in review and
 * silently costs the port.
 *
 * These rules are the ones a reader cannot enforce by being careful. They are
 * checked against the source text rather than by importing, so a violation is
 * caught even in a branch no test happens to execute.
 */

const CORE = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    // Test files may use node:test and node:assert; the shipped code may not.
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bwindow\./, why: "React Native has no window" },
  { pattern: /\bdocument\./, why: "React Native has no DOM" },
  { pattern: /\blocalStorage\b|\bsessionStorage\b/, why: "no web storage on React Native" },
  { pattern: /\bprocess\.env\b/, why: "config belongs to the platform, not to core" },
  { pattern: /\b__dirname\b|\brequire\s*\(/, why: "no CommonJS/node globals in core" },
  { pattern: /from\s+"node:/, why: "core must not depend on the node stdlib" },
  { pattern: /from\s+"react/, why: "core must not depend on a UI framework" },
  { pattern: /from\s+"@\/lib\//, why: "core must not reach back into platform code" },
  { pattern: /from\s+"@\/components\//, why: "core must not depend on components" },
  { pattern: /from\s+"@\/hooks\//, why: "core must not depend on hooks" },
];

test("core stays free of platform dependencies", () => {
  const violations: string[] = [];
  for (const file of sourceFiles(CORE)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      // Prose in a comment may legitimately mention these.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(code)) {
          violations.push(`${relative(CORE, file)}:${i + 1} — ${why}\n    ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(violations, [], `core is no longer platform-agnostic:\n${violations.join("\n")}`);
});

test("core imports resolve without a bundler", () => {
  // Relative imports inside core carry explicit .ts extensions so the modules
  // run under bare `node --test`, and so Metro does not have to be taught the
  // project's path aliases.
  const bad: string[] = [];
  for (const file of sourceFiles(CORE)) {
    for (const match of readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]*)"/g)) {
      const spec = match[1]!;
      if (!spec.endsWith(".ts")) bad.push(`${relative(CORE, file)} — ${spec}`);
    }
  }
  assert.deepEqual(bad, [], `relative imports in core need explicit .ts extensions:\n${bad.join("\n")}`);
});

/**
 * Runtime globals core does assume. These are fine on the web and on modern
 * Node; each one is a thing the React Native port must supply, polyfill, or
 * inject. Listed here so the list is discovered now rather than at build time.
 */
test("the runtime surface core needs is small and known", () => {
  const assumed = new Map<string, string>([
    ["fetch", "supplied via HttpTransport — React Native's native fetch fits"],
    ["Response", "used for reading; RN provides it"],
    ["URL", "RN provides it"],
    ["URLSearchParams", "RN provides it"],
    ["AbortSignal.timeout", "NOT on older RN runtimes — polyfill or drop timeouts"],
    ["crypto.randomUUID", "NOT on RN by default — injected via InstagramSession.randomToken"],
    ["setTimeout", "universal"],
  ]);

  const used = new Set<string>();
  for (const file of sourceFiles(CORE)) {
    const text = readFileSync(file, "utf8");
    for (const name of assumed.keys()) {
      if (text.includes(name)) used.add(name);
    }
  }
  // The point is the inventory, not the count: if core starts using something
  // outside this list, this test is where that gets noticed.
  for (const name of used) {
    assert.ok(assumed.has(name), `core uses an unlisted global: ${name}`);
  }
  assert.ok(used.has("fetch"), "sanity: the scan actually read the files");
});
