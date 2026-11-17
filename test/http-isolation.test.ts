import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSuite } from "../src/config.js";
import { openSession } from "../src/mcp.js";
import { startCounterServer } from "./fixtures/counter-http-server.js";

describe("HTTP server trial isolation", () => {
  let counter: Awaited<ReturnType<typeof startCounterServer>>;

  beforeAll(async () => {
    counter = await startCounterServer();
  });

  afterAll(() => counter.close());

  it("leaks state across sessions by default, since connecting does not reset the server", async () => {
    const suite = parseSuite({ server: { url: counter.url }, tasks: [{ id: "t", prompt: "p", assert: [{ type: "output_contains", value: "x" }] }] }, "/x");
    const a = await openSession(suite.server);
    try {
      expect((await a.callTool("increment", {})).text).toBe("1");
    } finally {
      await a.close();
    }

    const b = await openSession(suite.server);
    try {
      // A fresh session should see a clean counter, but without a reset hook it inherits the leftover state.
      expect((await b.callTool("get", {})).text).toBe("1");
    } finally {
      await b.close();
    }
  });

  it("resets state on every session when server.reset is configured", async () => {
    const suite = parseSuite(
      { server: { url: counter.url, reset: { tool: "reset" } }, tasks: [{ id: "t", prompt: "p", assert: [{ type: "output_contains", value: "x" }] }] },
      "/x",
    );
    const a = await openSession(suite.server);
    try {
      expect((await a.callTool("increment", {})).text).toBe("1");
    } finally {
      await a.close();
    }

    const b = await openSession(suite.server);
    try {
      expect((await b.callTool("get", {})).text).toBe("0");
    } finally {
      await b.close();
    }
  });
});
