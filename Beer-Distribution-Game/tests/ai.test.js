import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startWeek, teamCost, unitsInSystem } from '../src/engine.js';
import { systemPrompt, situation, request, decide, newRun, playWeek, estimate, SCHEMA, MODEL } from '../src/ai.js';

// the experiment the AI page starts from
const INPUT = { stages: 4, weeks: 33, initInv: 12, initPipeline: 4, scenario: 'custom', demandFrom: 4, demandTo: 8, stepWeek: 6 };

// a stand-in for the Anthropic client: answers with a rule, records every request
function fakeClient(rule) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (p) => {
      calls.push(p);
      const out = rule(p);
      if (out instanceof Error) throw out;
      if (out === 'refusal') return { stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 0 }, model: MODEL };
      return { stop_reason: 'end_turn', model: MODEL, usage: { input_tokens: 1000, output_tokens: 200 },
        content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(out) }] };
    } } },
  };
}
// the order received this week, read back from the prompt
const incoming = (p) => Number(/Order received from [^:]+: (\d+)/.exec(p.messages[0].content)[1]);

test('the experiment starts with 12 in stock and 4 in every order, shipping and production slot; demand 4, then 8 from week 6', () => {
  const g = newGame(INPUT);
  assert.deepEqual(g.cfg.demand.values.slice(0, 7), [4, 4, 4, 4, 4, 8, 8]);
  assert.equal(g.cfg.demand.values.length, 33);
  for (const s of g.stages) {
    assert.equal(s.inv, 12);
    assert.ok(s.inbound.every((x) => x === 4));
    assert.ok(s.outbound.every((x) => x === 4));
  }
  assert.equal(g.cfg.initPipeline, 4);
  // without the setting, the pipeline holds the base demand
  assert.equal(newGame({ scenario: 'step' }).stages[0].inbound[0], 6);
});

test('every AI is told the game never ends, and never how many weeks it lasts', () => {
  const g = newGame(INPUT);
  startWeek(g);
  for (const c of ['local', 'full']) for (let i = 0; i < 4; i++) {
    const sys = systemPrompt(g.cfg, i, c);
    assert.match(sys, /never ends/);
    assert.match(sys, /no last week/);
    assert.doesNotMatch(sys + situation(g, i, c), /33/);
  }
});

test('own stage only: only the store sees customer orders; the whole chain: everyone does', () => {
  const g = newGame(INPUT);
  startWeek(g);
  assert.match(situation(g, 0, 'local'), /Order received from customers: 4/);
  for (let i = 1; i < 4; i++) {
    const s = situation(g, i, 'local');
    assert.doesNotMatch(s, /customer/i);
    assert.doesNotMatch(s, /whole chain/);
  }
  for (let i = 0; i < 4; i++) {
    const s = situation(g, i, 'full');
    assert.match(s, /Customer orders at the store this week: 4/);
    assert.match(s, /\(you\)/);
  }
});

test('the request: Opus 5.5, structured answer, default fallbacks, effort set', () => {
  const g = newGame(INPUT);
  startWeek(g);
  const r = request(g, 2, 'local', 'keep steady', 'low');
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.fallbacks, 'default');
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(r.output_config.effort, 'low');
  assert.deepEqual(r.output_config.format, { type: 'json_schema', schema: SCHEMA });
  assert.equal(r.temperature, undefined);
  assert.match(r.messages[0].content, /Your note from last week: keep steady/);
});

test('a refusal, an error or a bad answer never stops the game', async () => {
  assert.deepEqual((await decide(fakeClient(() => 'refusal'), {})).problem, 'refusal');
  assert.equal((await decide(fakeClient(() => Object.assign(new Error('rate'), { status: 429 })), {})).problem, 'error 429');
  assert.equal((await decide(fakeClient(() => ({ reason: 'x', order: -3 })), {})).problem, 'invalid order');
  assert.deepEqual((await decide(fakeClient(() => ({ reason: 'ok', order: 7 })), {})).order, 7);
});

test('a run plays 33 weeks, every stage deciding on its own, and keeps every reason', async () => {
  const client = fakeClient((p) => ({ reason: 'pass it on', order: incoming(p) }));
  const run = newRun(INPUT, 'local');
  const start = unitsInSystem(run.game);
  while (!run.game.over) await playWeek(run, client, 'low');
  assert.equal(client.calls.length, 33 * 4);
  assert.equal(run.decisions.length, 33);
  assert.equal(run.game.history.length, 33);
  assert.equal(run.problems, 0);
  assert.equal(run.usage.input, 33 * 4 * 1000);
  assert.ok(run.decisions.every((w) => w.every((d) => d.reason === 'pass it on')));
  // passing orders on: units conserved, every order equals the one received
  assert.equal(unitsInSystem(run.game), start + run.game.produced - run.game.delivered);
  for (const h of run.game.history) h.stages.forEach((r) => assert.equal(r.order, r.incoming));
  assert.ok(teamCost(run.game) > 0);
  // the saved run is plain JSON and resumes
  const copy = JSON.parse(JSON.stringify(run));
  assert.deepEqual(copy.game.history, run.game.history);
});

test('a failed decision passes on the order received and is counted', async () => {
  const client = fakeClient((p) => (/Week 3\./.test(p.messages[0].content) ? 'refusal' : { reason: 'r', order: 5 }));
  const run = newRun(INPUT, 'full');
  for (let k = 0; k < 4; k++) await playWeek(run, client, 'low');
  assert.equal(run.problems, 4);
  const w3 = run.game.history[2];
  w3.stages.forEach((r) => { assert.equal(r.order, r.incoming); assert.equal(r.auto, 'ai-problem'); });
  assert.equal(run.decisions[2][0].problem, 'refusal');
  // the note carried forward is the last one written
  assert.match(client.calls.at(-1).messages[0].content, /Your note from last week: r/);
});

test('a rejected key stops the run and leaves the week open to play again', async () => {
  const run = newRun(INPUT, 'local');
  const bad = fakeClient(() => Object.assign(new Error('invalid x-api-key'), { status: 401 }));
  await assert.rejects(playWeek(run, bad, 'low'), (e) => e.fatal && /401/.test(e.message));
  assert.equal(run.game.history.length, 0);
  assert.equal(run.game.phase, 'decide');
  await playWeek(run, fakeClient((p) => ({ reason: 'ok', order: incoming(p) })), 'low');
  assert.equal(run.game.history.length, 1);
  assert.equal(run.game.history[0].demand, 4);
});

test('the estimate counts every decision', () => {
  const e = estimate(INPUT, ['local', 'full'], 'medium');
  assert.equal(e.calls, 2 * 4 * 33);
  assert.ok(e.dollars > 1 && e.dollars < 60);
});
