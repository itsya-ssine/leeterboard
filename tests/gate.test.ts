import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENTERED_KEY, hasEntered, markEntered } from "../src/gate.js";

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

describe("landing page gate", () => {
  it("shows the landing page on a fresh session, then remembers the visitor entered", () => {
    const store = fakeStore();
    assert.equal(hasEntered(store), false);
    markEntered(store);
    assert.equal(store.data[ENTERED_KEY], "1");
    assert.equal(hasEntered(store), true);
  });

  it("ignores any other stored value", () => {
    assert.equal(hasEntered(fakeStore({ [ENTERED_KEY]: "true" })), false);
  });

  it("still works (landing shows every time) when storage is missing or throws", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    };
    assert.equal(hasEntered(null), false);
    assert.doesNotThrow(() => markEntered(null));
    assert.equal(hasEntered(broken), false);
    assert.doesNotThrow(() => markEntered(broken));
  });
});
