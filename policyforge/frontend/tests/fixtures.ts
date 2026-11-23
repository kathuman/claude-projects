// The files the Python suite uses too: FoodNet, its JSON Schema, and the deliberately broken networks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Op } from "../src/lib/paths";
import type { Network } from "../src/lib/types";

const backend = resolve(__dirname, "../../backend");
const read = (p: string) => JSON.parse(readFileSync(resolve(backend, p), "utf-8"));

export const foodnet = (): Network => read("data/foodnet/network.json");
export const networkSchema = () => read("schemas/network.schema.json");
export const scenarioSchema = () => read("schemas/scenario.schema.json");

export interface BrokenCase {
  name: string; level: "field" | "reference"; browser: boolean; ops: Op[]; expect: { path: string; message: string };
}
export const broken = (): BrokenCase[] => read("tests/fixtures/broken_networks.json");
export const policySchema = () => read("schemas/policy.schema.json");
export const constitutionSchema = () => read("schemas/constitution.schema.json");
