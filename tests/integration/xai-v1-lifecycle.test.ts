import { describe, expect, it } from "bun:test"
import { z } from "zod"

const Result = z.object({
  partial: z.array(z.string()),
  xaiPartial: z.array(z.string()),
  cleanup: z.array(z.string()),
  enabled: z.array(z.string()),
  malformed: z.array(z.string()),
  samePromise: z.boolean(),
  setupFailure: z.boolean(),
  cleanupFailure: z.boolean(),
})

describe("V1 composition lifecycle", () => {
  it("attempts every owned cleanup and unwinds partial setup before propagating failure", async () => {
    // Given
    const program = `
      import { mock } from 'bun:test';
      let events = [];
      let failSetup = false;
      let failCleanup = false;
      let failXai = false;
      mock.module(${JSON.stringify(new URL("../../src/opencode/v1-module.ts", import.meta.url).pathname)}, () => ({
        buildV1AuthHooks: () => ({}), createV1AuthServer: () => async () => ({}),
        createV1Server: () => async () => {
          events.push('hooks-created');
          return { dispose: () => { events.push('hooks-disposed'); if (failCleanup) throw new TypeError('hook failure'); } };
        }
      }));
      mock.module(${JSON.stringify(new URL("../../src/opencode/claude-authority.ts", import.meta.url).pathname)}, () => ({
        startClaudeOwnerAuthority: () => {
          events.push('claude-created');
          if (failSetup) throw new TypeError('setup failure');
          return { dispose: () => { events.push('claude-disposed'); if (failCleanup) throw new TypeError('claude failure'); } };
        }
      }));
      mock.module(${JSON.stringify(new URL("../../src/opencode/xai-v1-host.ts", import.meta.url).pathname)}, () => ({
        buildV1XaiConsumerHooks: () => { throw new TypeError('consumer must not be constructed by connector'); },
        startV1XaiAuthority: async () => {
          events.push('xai-created');
          if (failXai) throw new TypeError('xai setup failure');
          return { dispose: () => { events.push('xai-disposed'); } };
        }
      }));
      const { connectorServer } = await import(${JSON.stringify(new URL("../../src/index.ts", import.meta.url).href)});
      failSetup = true;
      let setupFailure = false;
      try { await connectorServer({}, { providers: [], xaiOAuth: { mode: 'authority' } }); } catch (error) { if (!(error instanceof TypeError)) throw error; setupFailure = true; }
      const partial = events;
      events = []; failSetup = false; failXai = true;
      try { await connectorServer({}, { providers: [], xaiOAuth: { mode: 'authority' } }); } catch (error) { if (!(error instanceof TypeError)) throw error; }
      const xaiPartial = events;
      failXai = false;
      events = []; failSetup = false; failCleanup = true;
      const hooks = await connectorServer({}, { providers: [], xaiOAuth: { mode: 'authority' } });
      const first = hooks.dispose(); const samePromise = first === hooks.dispose();
      let cleanupFailure = false;
      try { await first; } catch (error) { if (!(error instanceof TypeError)) throw error; cleanupFailure = true; }
      const cleanup = events;
      events = []; failCleanup = false;
      for (const options of [{ providers: [] }, { providers: [], xaiOAuth: { mode: 'consumer' } }]) {
        await (await connectorServer({}, options)).dispose();
      }
      const enabled = events;
      events = [];
      try { await connectorServer({}, { xaiOAuth: { mode: 'unknown' } }); } catch (error) { if (!(error instanceof Error)) throw error; }
      process.stdout.write(JSON.stringify({ partial, xaiPartial, cleanup, enabled, malformed: events, samePromise, setupFailure, cleanupFailure }));
    `
    // When
    const child = Bun.spawn([process.execPath, "--eval", program], {
      env: { HOME: "/tmp/opencode", PATH: process.env["PATH"] ?? "/usr/bin" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    // Then
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(Result.parse(JSON.parse(stdout))).toEqual({
      partial: ["hooks-created", "claude-created", "hooks-disposed"],
      xaiPartial: [
        "hooks-created",
        "claude-created",
        "xai-created",
        "hooks-disposed",
        "claude-disposed",
      ],
      cleanup: [
        "hooks-created",
        "claude-created",
        "xai-created",
        "hooks-disposed",
        "claude-disposed",
        "xai-disposed",
      ],
      enabled: [
        "hooks-created",
        "claude-created",
        "hooks-disposed",
        "claude-disposed",
        "hooks-created",
        "claude-created",
        "hooks-disposed",
        "claude-disposed",
      ],
      malformed: [],
      samePromise: true,
      setupFailure: true,
      cleanupFailure: true,
    })
  })
})
