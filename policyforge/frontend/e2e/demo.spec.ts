// The brief's §10 demo, end to end in the browser (the P7 acceptance test).
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const intents = resolve(here, "../../backend/tests/fixtures/intents");
const DEMO = JSON.parse(readFileSync(resolve(intents, "05-demo-b-to-c-30.json"), "utf-8"));
const ANSWERED = JSON.parse(readFileSync(resolve(intents, "answers/demo-b-to-c-30.json"), "utf-8"));
const ANSWER = Object.values(ANSWERED.answers)[0] as string;
const C_ASSUMPTION = "assumption:shift-ambient-volume-from-b-to-c:c-spare-capacity";

test.setTimeout(600_000);

test("the §10 demo runs end to end in the browser", async ({ page, request }) => {
  // 1. Constitution: chilled service ≥ 97 %, expedite ≤ €20k a month, service → resilience → cost → carbon
  await page.goto("/app/#/constitution");
  const form = page.getByTestId("constitution-form");
  await expect(form).toBeVisible();
  const order = page.getByTestId("ordered-enum").locator("li");
  await expect(order).toHaveText([/service/, /resilience/, /cost/, /carbon/]);
  await expect(form.getByTestId("form-hard_constraints.0.threshold").getByRole("textbox")).toHaveValue("0.97");
  await expect(form.getByTestId("form-hard_constraints.2.threshold").getByRole("textbox")).toHaveValue("20000");
  await form.getByTestId("form-name").getByRole("textbox").fill("FoodNet operating constitution (demo)");
  await page.getByTestId("save-constitution").click();
  await expect(page.getByRole("status")).toContainText("version 2, now active");
  await expect(page.getByTestId("constitution-versions").locator("tr").first()).toContainText("active");

  // 2. Author: the intent compiles into a sourcing switch with three assumptions and one question; answer it
  await page.getByTestId("area-author").click();
  await page.getByTestId("intent").fill(DEMO.intent);
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("questions")).toContainText("above 30%");
  await expect(page.getByTestId("assumptions").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("back-translation")).toContainText("Supplier C");
  await page.getByTestId("answer-0").fill(ANSWER);
  await page.getByTestId("recompile").click();
  await expect(page.getByTestId("questions")).toHaveCount(0);
  await expect(page.getByTestId("policy-form")).toContainText("sourcing_switch");
  await expect(page.getByTestId("policy-status")).toHaveText("valid");
  await page.getByTestId("save-policy").click();
  await expect(page.getByRole("status")).toContainText("Saved shift-ambient-volume-from-b-to-c version 1");

  // 3. Stress test on the default suite against the incumbent and rolling optimisation
  await page.getByTestId("to-stress").click();
  await page.getByTestId("baseline-naive").uncheck();
  await page.getByTestId("st-reps").fill("30");
  await page.getByTestId("st-rolling").fill("3");
  await page.getByTestId("run-stress").click();
  await expect(page.getByTestId("job")).toBeVisible();
  const report = page.getByTestId("report");
  await expect(report).toBeVisible({ timeout: 300_000 });
  await expect(report.getByTestId("constitution-table").locator("tbody tr")).toHaveCount(8);
  await expect(report.getByTestId("legend").first()).toContainText("Rolling optimisation");
  await expect(report.getByTestId("tradeoffs")).toBeVisible();
  const first = await report.getByTestId("verdict").textContent();
  expect(["Approve", "Approve with conditions", "Reject"]).toContain(first);

  // 4. Edit the rule (cap expedite spend in the mandate), re-test, approve as owner, deploy
  await page.goto("/app/#/author?policy=shift-ambient-volume-from-b-to-c&version=1");
  await expect(page.getByTestId("policy-form")).toBeVisible();
  await page.getByTestId("add-mandate.autonomy").click();
  const limit = page.getByTestId("item-mandate.autonomy.1");
  await limit.getByLabel("kind", { exact: true }).selectOption("expedite_spend_per_period");
  await limit.getByLabel("value", { exact: true }).fill("5000");
  await expect(page.getByTestId("policy-status")).toHaveText("valid");
  await page.getByTestId("save-policy").click();
  await expect(page.getByRole("status")).toContainText("version 2");
  await page.getByTestId("to-stress").click();
  await expect(page.getByTestId("st-version")).toHaveValue("2");
  await page.getByTestId("baseline-naive").uncheck();
  await page.getByTestId("st-reps").fill("30");
  await page.getByTestId("st-rolling").fill("3");
  await page.getByTestId("run-stress").click();
  await expect(page.getByTestId("report")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId("report").getByTestId("verdict")).toHaveText("Approve");
  await page.getByRole("link", { name: /Open in the registry/ }).click();
  await expect(page.getByTestId("detail-status")).toHaveText("tested");
  await page.getByRole("textbox", { name: "Note" }).fill("Approved with the expedite cap");
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("detail-status")).toHaveText("approved");
  await page.getByTestId("deploy").click();
  await expect(page.getByTestId("detail-status")).toHaveText("deployed");
  const row = page.getByTestId("row-shift-ambient-volume-from-b-to-c@2");
  await expect(row.getByTestId("expires")).not.toBeEmpty();
  const trail = page.getByTestId("policy-audit");
  for (const a of ["policy.edited", "evaluation.recorded", "policy.approved", "policy.deployed"]) {
    await expect(trail, a).toContainText(a);
  }
  await expect(page.getByTestId("agent-mandate")).toContainText("sourcing-agent-01");
  await page.getByTestId("audit-tab").click();
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("chain-ok")).toContainText("Intact");

  // 5. Monitor: stream, capacity loss at Supplier C from week 20, the assumption alert tops the inbox, one-click re-test
  await page.getByTestId("area-monitor").click();
  await page.getByTestId("new-stream").click();
  await expect(page.getByTestId("week")).toHaveText("week 0");
  await page.getByTestId("step4").click();
  await expect(page.getByTestId("week")).toHaveText("week 4");
  await page.getByTestId("step4").click();
  await expect(page.getByTestId("week")).toHaveText("week 8");
  const inject = page.getByTestId("inject");
  await inject.getByLabel("Drift kind").selectOption("supplier_outage");
  await inject.getByLabel("Supplier").selectOption("SUP_C");
  await inject.getByLabel("Bites from week").fill("20");
  await inject.getByLabel("Severity").fill("0.6");
  await page.getByTestId("do-inject").click();
  await expect(page.getByRole("status")).toContainText("bites from week 20");
  await page.getByTestId("play").click();
  const top = page.getByTestId("inbox").locator("li").first();
  await expect(top).toHaveAttribute("data-monitor", C_ASSUMPTION, { timeout: 120_000 });
  const week = Number((await page.getByTestId("week").textContent())!.replace("week ", ""));
  expect(week).toBeGreaterThanOrEqual(20);
  expect(week).toBeLessThanOrEqual(24); // paused on the alert: raised within 4 periods of the drift
  await expect(top).toContainText("spare capacity");
  await top.getByTestId("retest").click();
  await expect(top.getByTestId("retest-result")).toBeVisible({ timeout: 300_000 });
  await expect(top.getByTestId("retest-result")).toContainText("suppliers.2.capacity_per_period");

  // 6. The agent reads its mandate
  const m = await (await request.get("/agents/sourcing-agent-01/mandate")).json();
  expect(m.status).toBe("active");
  expect(m.policy_id).toBe("shift-ambient-volume-from-b-to-c");
  expect(m.policy_version).toBe(2);
});
