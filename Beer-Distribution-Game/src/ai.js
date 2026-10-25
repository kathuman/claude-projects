// AI players: every stage's order decided each week by its own, independent call to Claude. Two conditions:
//   local  each AI sees only its own stage, as a real company would; only the store sees what customers order
//   full   each AI sees the whole chain: every stage's stock, debts, orders and shipments on their way, and the
//          customer orders so far (never the future)
// Every AI is told the game never ends, so no one runs stock down for a last week. The AIs cannot talk to each other;
// each one's only memory is its own history, given back to it every week, and the short note it wrote last week.
//
// The page passes in the Anthropic client, so tests run the whole experiment against a stand-in.

import { newGame, startWeek, placeOrders, view, supplyLine } from './engine.js';

export const MODEL = 'claude-opus-5-5';
// US dollars per million tokens, Claude Opus 5.5
export const PRICE = { input: 4, output: 20 };
export const CONDITIONS = {
  local: { label: 'Own stage only', blurb: 'Each AI sees only its own stage. Only the store sees what customers order.' },
  full: { label: 'Whole chain', blurb: 'Each AI sees every stage: stock, debts, orders and shipments on their way, and the customer orders so far.' },
};
export const EFFORTS = ['low', 'medium', 'high'];
// a rough guess at the output (thinking included) per decision, for the estimate shown before a run
export const OUTPUT_GUESS = { low: 700, medium: 1600, high: 3500 };

export const SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'One or two sentences: why this order.' },
    order: { type: 'integer', description: 'Units to order from your supplier this week (to produce, at the plant). Zero or more.' },
  },
  required: ['reason', 'order'],
  additionalProperties: false,
};

const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
const list = (a) => (a.length ? a.join(', ') : 'none');

// The rules of the chain, the same every week, for stage i.
export function systemPrompt(cfg, i, condition) {
  const n = cfg.stages;
  const me = cfg.names[i];
  const isPlant = i === n - 1;
  const customer = i === 0 ? 'its customers' : `the ${cfg.names[i - 1]}`;
  const chain = cfg.names.map((nm, k) => `${k + 1}. ${nm}`).join('; ');
  const lines = [
    `You run the ${me} in a supply chain of ${n} companies that brings one product to customers. In order from the customers up: ${chain}. Each company is run by a different, independent decision maker; you cannot talk to the others.`,
    '',
    'How every week works, at every company:',
    `- The goods that have reached you arrive and go into your stock.`,
    `- An order arrives from your customer (${i === 0 ? 'the people buying at the store' : customer}).`,
    '- You ship what you can of everything you owe, oldest first. What you cannot ship stays owed (backlog) and is shipped as soon as you have stock.',
    isPlant
      ? `- Then you decide how many units to start producing. Production takes ${plural(cfg.prodDelay, 'week')}; then the units go into your stock. Raw materials are always available.`
      : `- Then you decide how many units to order from your supplier, the ${cfg.names[i + 1]}. Your order takes ${plural(cfg.orderDelay, 'week')} to reach them; they ship what they can (if they are short, they owe you the rest), and shipments take ${plural(cfg.shipDelay, 'week')} to reach you.`,
    '',
    `Costs: every unit in your stock costs ${cfg.holding} per week; every unit you owe your customer costs ${cfg.backlog} per week. The goal is the lowest total cost for the whole chain, all companies together, not only for you.`,
    '',
    'The game never ends. It runs permanently: there is no last week, and you should never plan for one. Run your company so the chain stays healthy week after week, indefinitely.',
    '',
    condition === 'full'
      ? 'You see the whole chain: every company\'s stock and what it owes, the orders and shipments on their way between them, every company\'s past orders, and the customer orders so far. Nobody knows what customers will order in the future. The others see the same information as you.'
      : `You see only your own company: your stock, what you owe, the orders you receive, the goods you receive and your own past orders. You cannot see the other companies' stock or orders${i === 0 ? '' : ', and you do not see what the customers at the store order'}. Nobody knows what customers will order in the future.`,
    '',
    'Each week, answer with the whole number of units to order (zero or more) and a short reason. Your reason is shown back to you next week as your note.',
  ];
  return lines.join('\n');
}

// What stage i sees this week (the week has started: goods and orders have arrived, shipping is done).
export function situation(g, i, condition, note) {
  const cfg = g.cfg;
  const v = view(g, i);
  const n = cfg.stages;
  const isPlant = i === n - 1;
  const from = i === 0 ? 'customers' : `the ${cfg.names[i - 1]}`;
  const out = [`Week ${v.week}.`, ''];
  if (note) out.push(`Your note from last week: ${note}`, '');
  out.push('Your company this week:',
    `- Arrived into your stock: ${v.arrived}`,
    `- Order received from ${from}: ${v.incoming}`,
    `- Shipped to ${from}: ${v.shipped}`,
    `- Stock now: ${v.inventory}`,
    `- Still owed to ${from}: ${v.backlog}`,
    isPlant ? `- In production, not yet finished: ${v.supplyLine}` : `- Ordered from your supplier and not yet received: ${v.supplyLine}`,
    `- Your cost so far: ${v.cost}; this week's cost: ${v.weekCost}`);
  if (v.past.length) {
    out.push('', `Your past weeks (week, order received, arrived, stock, owed, your order):`);
    for (const p of v.past) out.push(`${p.week}, ${p.incoming}, ${p.arrived}, ${p.inv}, ${p.backlog}, ${p.order}`);
  }
  if (condition === 'full') {
    out.push('', 'The whole chain now (goods and orders on their way are listed with the one arriving next week first):');
    g.stages.forEach((s, k) => {
      const plant = k === n - 1;
      out.push(`- ${s.name}${k === i ? ' (you)' : ''}: stock ${s.inv}, owes ${s.backlog}; `
        + (plant ? `in production: ${list(s.inbound)}` : `goods on their way to it: ${list(s.inbound)}; its orders on their way to the ${cfg.names[k + 1]}: ${list(s.outbound)}`)
        + `; ordered and not yet received ${supplyLine(g, k)}; cost so far ${s.cost}`);
    });
    out.push(`- Customer orders at the store this week: ${g.pending.demand}`);
    if (g.history.length) {
      out.push('', `Past weeks for the whole chain (week, customer orders, then each company's order placed: ${cfg.names.join(', ')}; then each company's stock − owed):`);
      for (const h of g.history) out.push(`${h.week}, ${h.demand}, ${h.stages.map((r) => r.order).join(', ')}; ${h.stages.map((r) => r.inv - r.backlog).join(', ')}`);
    }
  }
  out.push('', 'How many units do you order this week?');
  return out.join('\n');
}

// The request for one decision.
export function request(g, i, condition, note, effort = 'medium') {
  return {
    model: MODEL,
    max_tokens: effort === 'high' ? 16000 : 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema: SCHEMA } },
    system: systemPrompt(g.cfg, i, condition),
    messages: [{ role: 'user', content: situation(g, i, condition, note) }],
  };
}

// One decision. Never throws: a refusal, an error or an unreadable answer becomes { order: null, problem }.
export async function decide(client, params) {
  try {
    const r = await client.beta.messages.create(params);
    const usage = { input: r.usage?.input_tokens ?? 0, output: r.usage?.output_tokens ?? 0,
      cacheRead: r.usage?.cache_read_input_tokens ?? 0, cacheWrite: r.usage?.cache_creation_input_tokens ?? 0 };
    if (r.stop_reason === 'refusal') return { order: null, problem: 'refusal', usage, model: r.model };
    if (r.stop_reason === 'max_tokens') return { order: null, problem: 'cut off', usage, model: r.model };
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const ans = JSON.parse(text);
    const order = Math.round(Number(ans.order));
    if (!Number.isFinite(order) || order < 0) return { order: null, problem: 'invalid order', usage, model: r.model };
    return { order, reason: String(ans.reason ?? '').slice(0, 600), usage, model: r.model };
  } catch (e) {
    return { order: null, problem: e?.status ? `error ${e.status}` : 'error', message: String(e?.message ?? e).slice(0, 300), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  }
}

export const dollars = (u) => (u.input * PRICE.input + u.cacheWrite * PRICE.input * 1.25 + u.cacheRead * PRICE.input * 0.1 + u.output * PRICE.output) / 1e6;

// A rough cost estimate before running: the prompt length of a mid-game week, a guess at the output per decision.
export function estimate(input, conditions, effort) {
  const g = newGame(input);
  let chars = 0;
  for (const c of conditions) for (let i = 0; i < g.stages.length; i++) chars += systemPrompt(g.cfg, i, c).length;
  const weeks = g.cfg.weeks;
  // the history grows week by week: on average half the game's rows, about 40 characters a row (more for the full view)
  const perCall = (c) => 900 + (weeks / 2) * (c === 'full' ? 110 : 30);
  const calls = conditions.length * g.stages.length * weeks;
  const inChars = chars * weeks + conditions.reduce((s, c) => s + perCall(c) * g.stages.length * weeks, 0);
  const u = { input: inChars / 3.5, output: calls * OUTPUT_GUESS[effort], cacheRead: 0, cacheWrite: 0 };
  return { calls, inputTokens: Math.round(u.input), outputTokens: u.output, dollars: dollars(u) };
}

// A run: one game played by AIs under one condition. Plain JSON, saved after every week so it can resume.
export function newRun(input, condition) {
  return { condition, game: newGame(input), notes: [], decisions: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, problems: 0 };
}

// Play one week of a run: every stage decides at the same time, independently. A failed decision orders what the
// stage was just asked for (it passes the order on) and is counted as a problem. A rejected key or request throws
// (error.fatal) and leaves the week open.
export async function playWeek(run, client, effort) {
  const g = run.game;
  if (g.phase === 'move') startWeek(g);
  const n = g.stages.length;
  const results = await Promise.all(g.stages.map((_, i) => decide(client, request(g, i, run.condition, run.notes[i], effort))));
  // a rejected key or request fails every call alike: stop before the week closes, so it can be played again
  const fatal = results.find((r) => /^error (400|401|403|404)$/.test(r.problem ?? ''));
  if (fatal) throw Object.assign(new Error(`${fatal.problem}: ${fatal.message}`), { fatal: true });
  const orders = results.map((r, i) => (r.order ?? g.pending.stages[i].incoming));
  const auto = results.map((r) => (r.order == null ? 'ai-problem' : null));
  run.decisions.push(results.map((r, i) => ({ order: orders[i], reason: r.reason ?? null, problem: r.problem ?? null, message: r.message ?? null, model: r.model ?? null })));
  for (const r of results) for (const k of Object.keys(run.usage)) run.usage[k] += r.usage[k] ?? 0;
  run.problems += results.filter((r) => r.order == null).length;
  run.notes = results.map((r, i) => r.reason ?? run.notes[i] ?? null);
  placeOrders(g, orders, Array(n).fill(null), auto);
  return results;
}
