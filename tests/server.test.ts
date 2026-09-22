import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server/app";
const payload = {
  role: "tank",
  round: 1,
  revision: 0,
  state: {},
  candidates: [
    {
      id: "hold",
      description: "Hold position",
      distance: 0,
      risk: 0,
      fire: false,
    },
  ],
};
test("health reports missing credentials; real route does not fake inference", async () => {
  const app = buildApp();
  const health = await app.inject("/api/health");
  assert.equal(health.json().configured, false);
  const r = await app.inject({ method: "POST", url: "/api/decision", payload });
  assert.equal(r.statusCode, 503);
  await app.close();
});
test("validates payload before invoking the SDK", async () => {
  let called = false;
  const app = buildApp({
    evaluate: async () => {
      called = true;
    },
  });
  const r = await app.inject({
    method: "POST",
    url: "/api/decision",
    payload: { ...payload, candidates: [] },
  });
  assert.equal(r.statusCode, 400);
  assert.equal(called, false);
  await app.close();
});
test("forwards closed-set questions and echoes snapshot identity", async () => {
  let question: any;
  const app = buildApp({
    evaluate: async (p) => {
      question = p;
      return {
        answers: { decision: { choice: "hold", confidence: 0.9 } },
        usage: { input_tokens: 10, output_tokens: 2 },
        model: "fixture",
      };
    },
  });
  const r = await app.inject({ method: "POST", url: "/api/decision", payload });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().choice, "hold");
  assert.equal(r.json().round, 1);
  assert.equal(question.questions.decision.type, "choice");
  assert.equal(question.questions.decision.criteria.hold, null);
  assert.equal(question.state.availablePlans[0].description, "Hold position");
  await app.close();
});
test("rejects invalid model choices and hides upstream secrets", async () => {
  const app = buildApp({
    evaluate: async () => {
      throw Error("secret-auth-value");
    },
  });
  const r = await app.inject({ method: "POST", url: "/api/decision", payload });
  assert.equal(r.statusCode, 502);
  assert.ok(!r.body.includes("secret-auth-value"));
  await app.close();
});
test("limits rapid repeated requests", async () => {
  const app = buildApp({
    evaluate: async () => ({
      answers: { decision: { choice: "hold", confidence: 1 } },
    }),
  });
  await app.inject({ method: "POST", url: "/api/decision", payload });
  const r = await app.inject({ method: "POST", url: "/api/decision", payload });
  assert.equal(r.statusCode, 429);
  await app.close();
});
test("rejects a choice outside the available candidates", async () => {
  const app = buildApp({
    evaluate: async () => ({
      answers: { decision: { choice: "invented", confidence: 1 } },
    }),
  });
  const r = await app.inject({ method: "POST", url: "/api/decision", payload });
  assert.equal(r.statusCode, 502);
  await app.close();
});
test("server accepts 250ms combat cadence while rejecting bursts", async () => {
  const app = buildApp({
    evaluate: async () => ({
      answers: { decision: { choice: "hold", confidence: 1 } },
    }),
  });
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/decision", payload }))
      .statusCode,
    200,
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/decision", payload }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/decision", payload }))
      .statusCode,
    429,
  );
  await app.close();
});
