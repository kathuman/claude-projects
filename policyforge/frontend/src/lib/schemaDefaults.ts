// Starting values from a JSON Schema: what "Add" puts in a list, what switching a union's kind produces, and the keys
// of a map whose keys come from an enum. The values are the schema's defaults or the least surprising valid choice.

import { deref, nonNull, type Schema } from "./schema";

export function resolve(root: Schema, s: Schema | undefined): Schema {
  return nonNull(root, deref(root, s ?? {})).schema;
}

export interface Branch { tag: string; schema: Schema }

/** The branches of a discriminated union (or [] when `s` is not one). */
export function branches(root: Schema, s: Schema): Branch[] {
  const d = s.discriminator;
  if (!d?.mapping) return [];
  return Object.entries(d.mapping as Record<string, string>).map(([tag, ref]) => ({ tag, schema: deref(root, { $ref: ref }) }));
}

export function tagOf(s: Schema): string | null {
  return s.discriminator?.propertyName ?? null;
}

function numberDefault(s: Schema): number {
  if (typeof s.minimum === "number") return s.minimum;
  if (typeof s.exclusiveMinimum === "number") return s.type === "integer" ? s.exclusiveMinimum + 1 : s.exclusiveMinimum + 1;
  if (typeof s.maximum === "number" && s.maximum < 0) return s.maximum;
  return 0;
}

export function defaultValue(root: Schema, raw: Schema, depth = 0): unknown {
  if (depth > 12) return null;
  const s0 = deref(root, raw);
  if ("default" in s0) return structuredClone(s0.default);
  const { schema: s, nullable } = nonNull(root, s0);
  if (nullable) return null;
  if ("const" in s) return s.const;
  const bs = branches(root, s);
  if (bs.length) return defaultValue(root, bs[0].schema, depth + 1);
  if (s.enum) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type.find((x: string) => x !== "null") : s.type;
  if (t === "number" || t === "integer") return numberDefault(s);
  if (t === "string") return s.format === "date-time" ? new Date().toISOString() : "";
  if (t === "boolean") return false;
  if (t === "array") {
    const n = s.minItems ?? 0;
    return Array.from({ length: n }, () => defaultValue(root, s.items ?? {}, depth + 1));
  }
  if (t === "object" || s.properties) {
    if (s.properties) {
      const req = new Set<string>(s.required ?? []);
      const out: Record<string, unknown> = {};
      for (const [k, p] of Object.entries(s.properties as Record<string, Schema>)) {
        const dp = deref(root, p);
        if (req.has(k) || "const" in dp || "default" in dp) out[k] = defaultValue(root, p, depth + 1);
      }
      return out;
    }
    const keys = mapKeys(root, s);
    return Object.fromEntries(keys.map((k) => [k, defaultValue(root, s.additionalProperties ?? {}, depth + 1)]));
  }
  return null;
}

/** Switch a union value to another kind, keeping the fields both kinds share. */
export function switchBranch(root: Schema, s: Schema, tag: string, old: Record<string, unknown> | null): unknown {
  const b = branches(root, s).find((x) => x.tag === tag);
  if (!b) return old;
  const fresh = defaultValue(root, b.schema) as Record<string, unknown>;
  const props = b.schema.properties ?? {};
  const out: Record<string, unknown> = { ...fresh };
  for (const [k, v] of Object.entries(old ?? {})) if (k in props && k !== tagOf(s)) out[k] = v;
  out[tagOf(s)!] = tag;
  return out;
}

/** The keys of a map (`additionalProperties`) whose keys are an enum, e.g. soft weights by objective. */
export function mapKeys(root: Schema, s: Schema): string[] {
  const names = s.propertyNames ? deref(root, s.propertyNames) : null;
  return (names?.enum as string[] | undefined) ?? [];
}

/** Move item `from` to `to` in a list (immutable). */
export function move<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
