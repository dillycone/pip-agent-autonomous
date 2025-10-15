import assert from "node:assert/strict";
import { test } from "node:test";

import { runStore } from "../src/server/runStore.js";

test("runStore manages independent runs and event streams", async () => {
  const runA = runStore.createRun();
  const runB = runStore.createRun();

  assert.notEqual(runA.id, runB.id);

  runStore.setStatus(runA.id, "running");
  runStore.setStatus(runB.id, "pending");

  const eventsA: string[] = [];
  const eventsB: string[] = [];

  const subA = runStore.subscribe(runA.id, (event) => {
    eventsA.push(`${event.event}:${event.id}`);
  });
  const subB = runStore.subscribe(runB.id, (event) => {
    eventsB.push(`${event.event}:${event.id}`);
  });

  runStore.appendEvent(runA.id, "status", { step: "transcribe" });
  runStore.appendEvent(runB.id, "status", { step: "draft" });

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(eventsA.length, 1);
  assert.equal(eventsB.length, 1);
  assert.ok(eventsA[0].startsWith("status"));
  assert.ok(eventsB[0].startsWith("status"));

  // Ensure status mutations are isolated
  runStore.setStatus(runA.id, "success");
  runStore.setStatus(runB.id, "error", { message: "failed" });

  assert.equal(runStore.getStatus(runA.id), "success");
  assert.equal(runStore.getStatus(runB.id), "error");

  subA.unsubscribe();
  subB.unsubscribe();
});
