// Every page key (data-i18n, data-i18n-attr) and every message the scripts pass to T() has a Spanish and a Danish
// translation, with nothing left over; placeholders are kept; translations keep the English HTML tags.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ES } from "../src/ui/i18n-es";
import { DA } from "../src/ui/i18n-da";

const root = join(__dirname, "..");
const pages = readdirSync(join(root, "web")).filter((f) => f.endsWith(".html"));
const english: Record<string, string> = {};
for (const f of pages) {
  const html = readFileSync(join(root, "web", f), "utf8");
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) english[m[3]] = m[5];
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((pair) => { english[pair.split("=")[1]] = ""; });
}
const pageKeys = Object.keys(english);

// every string literal inside a T( … ) call in the UI scripts, skipping the {vars} object
const src = readdirSync(join(root, "src/ui")).filter((f) => f.endsWith(".ts") && !f.startsWith("i18n")).map((f) => readFileSync(join(root, "src/ui", f), "utf8")).join(";\n");
const msgs = new Set<string>();
for (let i = src.indexOf("T("); i >= 0; i = src.indexOf("T(", i + 2)) {
  if (/[\w.$]/.test(src[i - 1] || "")) continue;
  let depth = 0, inVars = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '"') { const end = src.indexOf('"', j + 1); if (!inVars) msgs.add(src.slice(j + 1, end)); j = end; continue; }
    if (c === "{") inVars++; else if (c === "}") inVars--;
    else if (c === "(") depth++; else if (c === ")" && --depth === 0) break;
  }
}

const tags = (s: string) => (s.match(/<\/?[a-z0-9]+/gi) || []).map((t) => t.toLowerCase()).sort().join(" ");
const holes = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(" ");

describe("translations", () => {
  it("finds the texts to translate", () => {
    expect(pageKeys.length).toBeGreaterThan(30);
    expect(msgs.size).toBeGreaterThan(40);
  });
  for (const [lang, D] of [["es", ES], ["da", DA]] as const) {
    it(`${lang}: every page key and script message is translated, with nothing left over`, () => {
      expect(pageKeys.filter((k) => !(k in D.H))).toEqual([]);
      expect(Object.keys(D.H).filter((k) => !(k in english))).toEqual([]);
      expect([...msgs].filter((m) => !(m in D.T))).toEqual([]);
      expect(Object.keys(D.T).filter((m) => !msgs.has(m))).toEqual([]);
    });
    it(`${lang}: placeholders and HTML tags are kept, nothing is empty`, () => {
      expect(Object.keys(D.T).filter((m) => holes(m) !== holes(D.T[m]))).toEqual([]);
      expect(pageKeys.filter((k) => english[k] && k in D.H && tags(english[k]) !== tags(D.H[k]))).toEqual([]);
      expect(Object.entries({ ...D.H, ...D.T }).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([]);
    });
  }
});
