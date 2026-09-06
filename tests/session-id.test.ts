import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionId } from "../web/src/session-id.js";

test("uses randomUUID when it is available", () => {
  const expected = "12345678-1234-4123-8123-123456789abc";
  assert.equal(createSessionId({ randomUUID: () => expected }), expected);
});

test("creates an ID when randomUUID is unavailable in an insecure context", () => {
  const id = createSessionId({
    getRandomValues: (bytes) => {
      bytes.fill(0xab);
      return bytes;
    },
  });

  assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});

test("still creates an ID when the Web Crypto API is entirely unavailable", () => {
  const id = createSessionId(undefined, () => 0.25);
  assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});
