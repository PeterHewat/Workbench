import { describe, expect, test } from "bun:test";
import { registerServiceWorker } from "./index.js";

describe("registerServiceWorker", () => {
  test("does nothing, and throws nothing, where service workers are unavailable", () => {
    // Private windows, file:// and older browsers all land here. An app must still run.
    const g = globalThis as unknown as { navigator?: unknown; window?: unknown };
    const hadNavigator = "navigator" in g;
    if (!hadNavigator) g.navigator = {};
    expect(() => registerServiceWorker()).not.toThrow();
    if (!hadNavigator) delete g.navigator;
  });
});
