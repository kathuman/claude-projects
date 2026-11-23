// A form generated from a JSON Schema (P7): the policy and the constitution are edited with it, so the screens can
// never fall out of step with the Python models. Objects, nullable fields, enums, numbers with bounds, lists of
// objects (add, remove, move), discriminated unions (a kind picker), maps keyed by an enum, and id pickers.

import { useEffect, useState } from "react";
import { getAt } from "../lib/paths";
import { bounds, deref, fieldsAt, nonNull, type Field, type Schema } from "../lib/schema";
import { branches, defaultValue, mapKeys, move, resolve, switchBranch, tagOf } from "../lib/schemaDefaults";
import { NumberInput } from "./Inspector";

export interface FormIssue { path: string; message: string }

export interface FormProps {
  root: Schema;
  doc: unknown;
  path: string;
  onChange: (path: string, value: unknown) => void;
  issues?: FormIssue[];
  /** Options for id fields: the field's key and path give the list of ids (or null for free text). */
  refs?: (key: string, path: string) => string[] | null;
  skip?: string[];
  readOnly?: string[];
  /** Render this path's fields directly, without a kind picker (set by the picker itself). */
  fieldsOnly?: boolean;
}

const join = (path: string, key: string | number) => (path === "" ? String(key) : `${path}.${key}`);

function Label({ f }: { f: { label: string; description?: string } }) {
  return (
    <label className="lbl pt-1 leading-tight" title={f.description}>{f.label}
      {f.description && <div className="normal-case tracking-normal font-body font-normal text-[11px] text-ink-faint">{f.description}</div>}
    </label>
  );
}

function Errors({ issues, path }: { issues?: FormIssue[]; path: string }) {
  const mine = (issues ?? []).filter((i) => i.path === path);
  return <>{mine.map((e, k) => <div key={k} className="err" data-testid="form-error">{e.message}</div>)}</>;
}

export default function SchemaForm(props: FormProps) {
  const { root, doc, path, skip = [] } = props;
  const value = getAt(doc, path);
  const here = nonNull(root, deref(root, schemaHere(root, doc, path))).schema;
  const bs = branches(root, here);
  if (bs.length && !props.fieldsOnly) return <UnionBox {...props} schema={here} />;
  const fields = fieldsAt(root, doc, path).filter((f) => !skip.includes(f.key) && !("const" in f.schema));
  if (!fields.length && value && typeof value === "object") return null;
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => <Row key={f.key} {...props} fieldsOnly={false} f={f} path={join(path, f.key)} />)}
    </div>
  );
}

/** The schema at a path, without picking a union branch (so the kind picker can show every branch). */
function schemaHere(root: Schema, doc: unknown, path: string): Schema {
  if (path === "") return root;
  const parts = path.split(".");
  const last = parts.pop()!;
  const parentPath = parts.join(".");
  const parentFields = fieldsAt(root, doc, parentPath);
  const f = parentFields.find((x) => x.key === last);
  if (f) return f.schema;
  // inside a list: the item schema of the parent list
  const listParent = parts.length ? parts.slice(0, -1).join(".") : "";
  const listKey = parts.length ? parts[parts.length - 1] : "";
  const lf = fieldsAt(root, doc, listParent).find((x) => x.key === listKey);
  if (lf && /^\d+$/.test(last)) return resolve(root, lf.schema.items);
  return {};
}

function UnionBox(props: FormProps & { schema: Schema }) {
  const { root, doc, path, onChange, schema } = props;
  const value = (getAt(doc, path) ?? {}) as Record<string, unknown>;
  const tag = tagOf(schema)!;
  const kinds = branches(root, schema).map((b) => b.tag);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="lbl">Kind</span>
        <select className="inp" aria-label={`${path || "value"} kind`} value={String(value[tag] ?? "")}
          onChange={(e) => onChange(path, switchBranch(root, schema, e.target.value, value))}>
          {kinds.map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <SchemaForm {...props} fieldsOnly skip={[...(props.skip ?? []), tag]} />
    </div>
  );
}

function Row(props: FormProps & { f: Field }) {
  const { f, path, doc, onChange, root, issues, refs, readOnly = [] } = props;
  const value = getAt(doc, path) as any;
  const bad = (issues ?? []).some((i) => i.path === path);
  const locked = readOnly.includes(f.key);
  let control: React.ReactNode = null;
  const opts = refs?.(f.key, path) ?? null;

  if (f.kind === "union") {
    return (
      <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0" data-testid={`form-${path}`}>
        <legend className="lbl px-1">{f.label}</legend>
        <SchemaForm {...props} path={path} fieldsOnly={false} skip={[]} />
        <Errors issues={issues} path={path} />
      </fieldset>
    );
  }
  if (f.kind === "object" && f.schema.properties) {
    if (value == null) {
      return (
        <div className="flex items-center gap-2">
          <span className="lbl">{f.label}</span><span className="text-[12px] text-ink-faint">none</span>
          <button className="btn ml-auto" onClick={() => onChange(path, defaultValue(root, f.schema))}>Add</button>
        </div>
      );
    }
    return (
      <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0" data-testid={`form-${path}`}>
        <legend className="lbl px-1 flex items-center gap-2">{f.label}
          {f.nullable && <button className="text-ink-faint hover:text-bad" title="Remove" onClick={() => onChange(path, null)}>×</button>}</legend>
        <SchemaForm {...props} path={path} skip={[]} fieldsOnly={false} />
      </fieldset>
    );
  }
  if (f.kind === "object" && f.schema.additionalProperties) {
    const keys = mapKeys(root, f.schema);
    const item = resolve(root, f.schema.additionalProperties);
    return (
      <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0" data-testid={`form-${path}`}>
        <legend className="lbl px-1">{f.label}</legend>
        {f.description && <div className="text-[11px] text-ink-faint mb-1">{f.description}</div>}
        {keys.map((k) => (
          <div key={k} className="grid grid-cols-[130px_1fr] gap-x-2 items-center mb-1">
            <span className="mono text-[12.5px]">{k}</span>
            <NumberInput value={value?.[k] ?? null} nullable={false} bad={false} label={`${f.key}.${k}`}
              hint={bounds(item)} onChange={(v) => onChange(path, { ...(value ?? {}), [k]: v ?? 0 })} />
          </div>
        ))}
      </fieldset>
    );
  }
  if (f.kind === "array") {
    const item = resolve(root, f.schema.items);
    const list: unknown[] = Array.isArray(value) ? value : [];
    if (item.properties || branches(root, item).length) {
      return <ObjectList {...props} item={item} list={list} />;
    }
    const itemOpts = item.enum as string[] | undefined ?? opts;
    if (itemOpts && (f.key === "priorities" || f.key === "priority")) { // rankings: the order is the meaning
      return <OrderedEnum label={f} list={list as string[]} options={itemOpts} onChange={(v) => onChange(path, v)} />;
    }
    if (itemOpts) {
      control = (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {itemOpts.map((o) => (
            <label key={o} className="flex items-center gap-1 mono text-[12.5px]">
              <input type="checkbox" checked={list.includes(o)} disabled={locked}
                onChange={(e) => onChange(path, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />{o}</label>
          ))}
          {!list.length && <span className="text-[11px] text-ink-faint">none</span>}
        </div>
      );
    } else {
      control = <TextList value={list as (string | number)[]} numeric={item.type === "number" || item.type === "integer"}
        label={f.key} onChange={(v) => onChange(path, v)} bad={bad} />;
    }
  } else if (opts) {
    control = (
      <select className={`inp w-full ${bad ? "bad" : ""}`} value={value ?? ""} aria-label={f.key} disabled={locked}
        onChange={(e) => onChange(path, e.target.value === "" && f.nullable ? null : e.target.value)}>
        {(f.nullable || !opts.includes(value)) && <option value="">{value && !opts.includes(value) ? `${value} (unknown)` : "—"}</option>}
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.kind === "enum") {
    control = (
      <select className={`inp w-full ${bad ? "bad" : ""}`} value={value ?? ""} aria-label={f.key} disabled={locked}
        onChange={(e) => onChange(path, e.target.value === "" ? null : e.target.value)}>
        {f.nullable && <option value="">—</option>}
        {(f.schema.enum as string[]).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.kind === "number" || f.kind === "integer") {
    control = locked ? <span className="mono">{value}</span>
      : <NumberInput value={value ?? null} nullable={f.nullable} bad={bad} label={f.key} hint={bounds(f.schema)}
        onChange={(v) => onChange(path, f.kind === "integer" && v !== null ? Math.round(v) : v)} />;
  } else if (f.kind === "boolean") {
    control = <input type="checkbox" checked={!!value} disabled={locked} aria-label={f.key}
      onChange={(e) => onChange(path, e.target.checked)} />;
  } else if (f.kind === "string") {
    const long = (f.schema.maxLength ?? 0) > 200;
    control = locked ? <span className="mono text-[12.5px] break-all">{String(value ?? "")}</span>
      : long ? <textarea className={`inp w-full ${bad ? "bad" : ""}`} rows={2} value={value ?? ""} aria-label={f.key}
        onChange={(e) => onChange(path, e.target.value)} />
        : <input className={`inp w-full ${bad ? "bad" : ""}`} value={value ?? ""} aria-label={f.key}
          onChange={(e) => onChange(path, f.nullable && e.target.value === "" ? null : e.target.value)} />;
  } else {
    control = <span className="mono text-[11.5px] text-ink-faint break-all">{JSON.stringify(value)}</span>;
  }
  return (
    <div className="grid grid-cols-[150px_1fr] gap-x-2 items-start" data-testid={`form-${path}`}>
      <Label f={f} />
      <div className="min-w-0">{control}<Errors issues={issues} path={path} /></div>
    </div>
  );
}

function ObjectList(props: FormProps & { f: Field; item: Schema; list: unknown[] }) {
  const { f, path, onChange, root, item, list, issues } = props;
  const max = f.schema.maxItems ?? Infinity;
  const min = f.schema.minItems ?? 0;
  return (
    <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0" data-testid={`form-${path}`}>
      <legend className="lbl px-1">{f.label} ({list.length})</legend>
      {f.description && <div className="text-[11px] text-ink-faint mb-1">{f.description}</div>}
      <div className="flex flex-col gap-2">
        {list.map((_, i) => (
          <div key={i} className="border-l-2 border-line pl-2" data-testid={`item-${path}.${i}`}>
            <div className="flex items-center gap-1 mb-1">
              <span className="mono text-[11px] text-ink-faint">#{i + 1}</span>
              <button className="text-ink-faint hover:text-accent px-1" title="Up" disabled={i === 0}
                onClick={() => onChange(path, move(list, i, i - 1))}>↑</button>
              <button className="text-ink-faint hover:text-accent px-1" title="Down" disabled={i === list.length - 1}
                onClick={() => onChange(path, move(list, i, i + 1))}>↓</button>
              <button className="text-ink-faint hover:text-bad px-1 ml-auto" title="Remove" disabled={list.length <= min}
                onClick={() => onChange(path, list.filter((__, j) => j !== i))}>Remove</button>
            </div>
            <SchemaForm {...props} path={join(path, i)} skip={[]} fieldsOnly={false} />
          </div>
        ))}
      </div>
      <Errors issues={issues} path={path} />
      <button className="btn mt-2" data-testid={`add-${path}`} disabled={list.length >= max}
        onClick={() => onChange(path, [...list, defaultValue(root, item)])}>Add</button>
    </fieldset>
  );
}

function OrderedEnum({ label, list, options, onChange }: { label: Field; list: string[]; options: string[];
  onChange: (v: string[]) => void }) {
  const missing = options.filter((o) => !list.includes(o));
  return (
    <div className="grid grid-cols-[150px_1fr] gap-x-2 items-start" data-testid="ordered-enum">
      <Label f={label} />
      <ol className="m-0 pl-5">
        {list.map((o, i) => (
          <li key={o} className="mono text-[13px] flex items-center gap-2">
            <span className="w-28">{i + 1}. {o}</span>
            <button className="btn" disabled={i === 0} aria-label={`move ${o} up`} onClick={() => onChange(move(list, i, i - 1))}>↑</button>
            <button className="btn" disabled={i === list.length - 1} aria-label={`move ${o} down`}
              onClick={() => onChange(move(list, i, i + 1))}>↓</button>
          </li>
        ))}
        {missing.map((o) => (
          <li key={o} className="text-ink-faint text-[12px]">{o} is missing <button className="btn"
            onClick={() => onChange([...list, o])}>Add</button></li>
        ))}
      </ol>
    </div>
  );
}

function TextList({ value, numeric, onChange, label, bad }: { value: (string | number)[]; numeric: boolean;
  onChange: (v: (string | number)[]) => void; label: string; bad: boolean }) {
  const [text, setText] = useState(value.join(" "));
  useEffect(() => setText((t) => (t.split(/[\s,]+/).filter(Boolean).join(" ") === value.join(" ") ? t : value.join(" "))), [value]);
  return (
    <input className={`inp w-full ${bad ? "bad" : ""}`} value={text} aria-label={label}
      placeholder="separate with spaces"
      onChange={(e) => {
        setText(e.target.value);
        const parts = e.target.value.split(/[\s,]+/).filter(Boolean);
        onChange(numeric ? parts.map(Number).filter((x) => !Number.isNaN(x)) : parts);
      }} />
  );
}
