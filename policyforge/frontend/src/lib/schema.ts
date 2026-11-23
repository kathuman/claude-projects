// Instant field checks in the browser, from the JSON Schema exported by the Python models (the one source of
// truth). Two rewrites make Ajv's errors land on the right field, and messages are worded as Pydantic words them,
// so the browser and the server say the same thing (the shared broken-network fixtures check both).

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type Schema = Record<string, any>;

/** Rewrite Pydantic's schema for Ajv: discriminated unions → if/then on the tag; `anyOf [T, null]` → nullable T. */
export function prepare(schema: Schema): Schema {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    let out: Schema = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    if (out.discriminator && out.oneOf) {
      const { propertyName: tag, mapping } = out.discriminator as { propertyName: string; mapping: Record<string, string> };
      const { discriminator: _d, oneOf: _o, ...rest } = out;
      out = {
        ...rest, type: "object", required: [tag], properties: { [tag]: { enum: Object.keys(mapping) } },
        allOf: Object.entries(mapping).map(([k, ref]) => ({
          // `type: "object"` keeps null (a nullable union) from matching every branch
          if: { type: "object", properties: { [tag]: { const: k } }, required: [tag] }, then: { $ref: ref } })),
      };
    }
    if (Array.isArray(out.anyOf) && out.anyOf.length === 2) {
      const nonNull = out.anyOf.filter((s: Schema) => s.type !== "null");
      if (nonNull.length === 1 && out.anyOf.some((s: Schema) => s.type === "null")) {
        const { anyOf: _a, ...rest } = out;
        const t = nonNull[0];
        out = t.$ref ? { ...rest, if: { type: "null" }, else: { $ref: t.$ref } }
          : { ...rest, ...t, type: [t.type, "null"], ...(t.enum ? { enum: [...t.enum, null] } : {}) };
      }
    }
    return out;
  };
  return walk(schema);
}

const fmt = (x: unknown) => (typeof x === "string" ? `'${x}'` : String(x));
const orList = (xs: unknown[]) => (xs.length === 1 ? fmt(xs[0])
  : `${xs.slice(0, -1).map(fmt).join(", ")} or ${fmt(xs[xs.length - 1])}`);

const TYPE_WORD: Record<string, string> = {
  number: "a valid number", integer: "a valid integer", string: "a valid string", array: "a valid list",
  object: "a valid dictionary", boolean: "a valid boolean",
};

/** Pydantic's wording for an Ajv error. */
export function message(e: ErrorObject): string {
  const p = e.params as Record<string, any>;
  switch (e.keyword) {
    case "minimum": return `Input should be greater than or equal to ${p.limit}`;
    case "exclusiveMinimum": return `Input should be greater than ${p.limit}`;
    case "maximum": return `Input should be less than or equal to ${p.limit}`;
    case "exclusiveMaximum": return `Input should be less than ${p.limit}`;
    case "enum": return `Input should be ${orList(p.allowedValues)}`;
    case "const": return `Input should be ${fmt(p.allowedValue)}`;
    case "required": return "Field required";
    case "additionalProperties": return "Extra inputs are not permitted";
    case "pattern": return `String should match pattern '${p.pattern}'`;
    case "maxLength": return `String should have at most ${p.limit} characters`;
    case "minLength": return `String should have at least ${p.limit} characters`;
    case "minItems": return `List should have at least ${p.limit} item${p.limit === 1 ? "" : "s"} after validation`;
    case "maxItems": return `List should have at most ${p.limit} items after validation`;
    case "type": {
      const t = (Array.isArray(p.type) ? p.type : String(p.type).split(",")).find((x: string) => x !== "null");
      return `Input should be ${TYPE_WORD[t] ?? t}`;
    }
    default: return e.message ?? e.keyword;
  }
}

/** The dotted path of the field at fault: required and extra fields name the field itself. */
export function errorPath(e: ErrorObject): string {
  const base = e.instancePath.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const p = e.params as Record<string, any>;
  if (e.keyword === "required") base.push(p.missingProperty);
  if (e.keyword === "additionalProperties") base.push(p.additionalProperty);
  return base.join(".");
}

export interface FieldIssue { path: string; message: string }

export class FieldChecker {
  private readonly validate: ValidateFunction;
  readonly schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false }); // date-times are checked by the API
    this.validate = ajv.compile(prepare(schema));
  }

  check(doc: unknown): FieldIssue[] {
    if (this.validate(doc)) return [];
    const seen = new Set<string>();
    const out: FieldIssue[] = [];
    for (const e of this.validate.errors ?? []) {
      if (e.keyword === "if") continue; // the "then" error below it says what is wrong
      const issue = { path: errorPath(e), message: message(e) };
      const key = `${issue.path}|${issue.message}`;
      if (!seen.has(key)) { seen.add(key); out.push(issue); }
    }
    return out;
  }
}

// ---------------------------------------------------------------- reading the schema for generated forms
export function deref(root: Schema, s: Schema | undefined): Schema {
  let cur = s ?? {};
  for (let i = 0; i < 20 && cur.$ref; i++) {
    const name = String(cur.$ref).split("/").pop()!;
    const { $ref: _r, ...rest } = cur;
    cur = { ...root.$defs?.[name], ...rest };
  }
  return cur;
}

/** The non-null alternative of a nullable field, and whether it may be null. */
export function nonNull(root: Schema, s: Schema): { schema: Schema; nullable: boolean } {
  const alts: Schema[] | undefined = s.anyOf;
  if (alts && alts.some((a) => a.type === "null")) {
    const rest = alts.filter((a) => a.type !== "null");
    if (rest.length === 1) {
      const { anyOf: _a, ...outer } = s;
      return { schema: { ...deref(root, rest[0]), ...outer }, nullable: true };
    }
  }
  return { schema: deref(root, s), nullable: false };
}

/** For a discriminated union, the branch matching the value's tag. */
export function branch(root: Schema, s: Schema, value: any): Schema {
  if (s.discriminator && value && typeof value === "object") {
    const ref = s.discriminator.mapping?.[value[s.discriminator.propertyName]];
    if (ref) return deref(root, { $ref: ref });
  }
  return s;
}

/** The subschema at a dotted path in a document, following refs, items and the value's union branches. */
export function schemaAt(root: Schema, doc: any, path: string): Schema | null {
  let s: Schema = root;
  let v: any = doc;
  for (const key of path === "" ? [] : path.split(".")) {
    s = branch(root, nonNull(root, s).schema, v);
    if (s.type === "array" || s.items) s = s.items ?? {};
    else if (s.properties?.[key]) s = s.properties[key];
    else return null;
    v = v?.[key];
  }
  return branch(root, nonNull(root, s).schema, v);
}

export interface Field {
  key: string;
  label: string;
  schema: Schema;
  required: boolean;
  nullable: boolean;
  description: string;
  kind: "number" | "integer" | "string" | "enum" | "boolean" | "object" | "array" | "union" | "other";
}

const KIND_OF = (s: Schema): Field["kind"] => {
  if (s.enum) return "enum";
  if (s.discriminator) return "union";
  const t = Array.isArray(s.type) ? s.type.find((x: string) => x !== "null") : s.type;
  if (t === "number" || t === "integer" || t === "string" || t === "boolean" || t === "object" || t === "array") return t;
  if (s.properties) return "object";
  return "other";
};

/** The fields of the object at `path`, in schema order, ready for a generated form. */
export function fieldsAt(root: Schema, doc: any, path: string): Field[] {
  const s = schemaAt(root, doc, path);
  if (!s?.properties) return [];
  const req = new Set<string>(s.required ?? []);
  return Object.entries(s.properties as Record<string, Schema>).map(([key, raw]) => {
    const { schema, nullable } = nonNull(root, raw);
    return { key, label: raw.title ?? schema.title ?? key, schema, required: req.has(key), nullable,
      description: raw.description ?? schema.description ?? "", kind: KIND_OF(schema) };
  });
}

/** Human bounds for a number field: "0 – 1", "> 0", "≤ 365". */
export function bounds(s: Schema): string {
  const lo = s.minimum ?? s.exclusiveMinimum;
  const hi = s.maximum ?? s.exclusiveMaximum;
  const loS = lo === undefined ? "" : `${"exclusiveMinimum" in s ? ">" : "≥"} ${lo}`;
  const hiS = hi === undefined ? "" : `${"exclusiveMaximum" in s ? "<" : "≤"} ${hi}`;
  return [loS, hiS].filter(Boolean).join(", ");
}
