import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { packCleanSource } from "./packed-package"

const projectRoot = join(import.meta.dir, "..", "..")
const InspectionSchema = z.object({
  names: z.array(z.string()),
  kinds: z.array(z.string()),
  consumer: z.array(
    z.object({
      provider: z.string(),
      methods: z.array(z.unknown()),
      sentinel: z.string(),
      headers: z.array(z.string()),
      text: z.string(),
      disposed: z.boolean(),
      authKeys: z.array(z.string()),
    }),
  ),
  disabled: z.boolean(),
  authority: z.boolean(),
})

describe("packaged xAI entrypoint", () => {
  it("dispatches packaged root and dedicated consumers and owns authority shutdown", async () => {
    // Given
    const directory = await mkdtemp(join(projectRoot, ".xai-package-"))
    const packageDirectory = join(directory, "package")
    let packed: Awaited<ReturnType<typeof packCleanSource>> | undefined
    try {
      packed = await packCleanSource({ projectRoot })
      await mkdir(packageDirectory)
      const extract = Bun.spawn(
        ["tar", "-xzf", packed.tarballPath, "--strip-components=1", "-C", packageDirectory],
        { stderr: "pipe", stdout: "pipe" },
      )
      const extractExitCode = await extract.exited
      expect(extractExitCode).toBe(0)

      // When
      const inspectorPath = join(packageDirectory, "inspect.mjs")
      await writeFile(
        inspectorPath,
        `
            const xai = await import('opencode-ext-connector/xai');
            const names = Object.keys(xai);
            const kinds = Object.values(xai).map((value) => typeof value);
            const root = await import('opencode-ext-connector');
            const fs = await import('node:fs/promises');
            const { watch } = await import('node:fs');
            const { createOpenAI } = await import('@ai-sdk/openai');
            const home = ${JSON.stringify(join(directory, "home"))};
            process.env.HOME = home;
            process.env.XDG_DATA_HOME = home + '/data';
            await fs.mkdir(home + '/data/opencode', { recursive: true });
            await fs.mkdir(home + '/.local/bin', { recursive: true });
            const accessPath = home + '/data/opencode/xai-access.json';
            const writeAccess = (access) => fs.writeFile(accessPath, JSON.stringify({ schema_version: 1, provider: 'xai', state: 'ready', access, expires: Date.now() + 60000 }), { mode: 0o600 });
            const consumer = [];
            for (const entry of [root.xaiAuthServer, xai.xaiAuthServer]) {
              const headers = [];
              globalThis.fetch = async (url, init) => {
                headers.push(new Headers(init.headers).get('authorization'));
                if (String(url) !== 'https://api.x.ai/v1/chat/completions' || init.redirect !== 'error') throw new TypeError('wrong dispatch');
                return new Response('data: {"id":"synthetic","object":"chat.completion.chunk","created":1,"model":"synthetic-model","choices":[{"index":0,"delta":{"content":"synthetic-result"},"finish_reason":null}]}\\n\\ndata: [DONE]\\n\\n', { headers: { 'content-type': 'text/event-stream' } });
              };
              const hooks = await entry({}, { providers: [], xaiOAuth: { mode: 'consumer' } });
              const selected = await hooks.auth.loader(async () => ({ type: 'api', key: 'cli-session:xai' }), {});
              if (Object.keys(await hooks.auth.loader(async () => undefined, {})).length || Object.keys(await hooks.auth.loader(async () => ({ type: 'api', key: 'native-key' }), {})).length) throw new TypeError('gate bypass');
              if (typeof selected.fetch.preconnect === 'function') selected.fetch.preconnect('https://foreign.example');
              await writeAccess('synthetic-A');
              const model = createOpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: selected.apiKey, fetch: selected.fetch }).chat('synthetic-model');
              const result = await model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic prompt' }] }] });
              let text = '';
              for await (const part of result.stream) { if (part.type === 'text-delta') text += part.delta; if (part.type === 'error') throw part.error; }
              await writeAccess('synthetic-B');
              await selected.fetch('https://api.x.ai/v1/chat/completions');
              let foreignBlocked = false;
              try { await selected.fetch('https://foreign.example/v1/chat/completions'); } catch (error) { if (!(error instanceof Error)) throw error; foreignBlocked = true; }
              if (!foreignBlocked || headers.length !== 2) throw new TypeError('bearer leak');
              await hooks.dispose();
              let disposed = false;
              try { await selected.fetch('https://api.x.ai/v1/chat/completions'); } catch (error) { if (!(error instanceof Error)) throw error; disposed = true; }
              consumer.push({ provider: hooks.auth.provider, methods: hooks.auth.methods, sentinel: selected.apiKey, headers, text, disposed, authKeys: Object.keys(hooks.auth).sort() });
            }
            const disabled = Object.keys(await xai.xaiAuthServer({})).length === 0 && Object.keys(await root.xaiAuthServer({}, { xaiOAuth: { mode: 'authority' } })).length === 0;
            await fs.writeFile(home + '/.local/bin/opensandbox-xai-auth-sync', '#!/bin/sh\\n[ "$#" -eq 0 ] || exit 9\\n[ "$PATH" = "/usr/local/bin:/usr/bin:/bin" ] || exit 10\\nprintf "%s" "$$" > "$HOME/helper-started"\\nexec /usr/bin/sleep 60\\n', { mode: 0o700 });
            const started = new Promise((resolve, reject) => {
              const timer = setTimeout(() => { watcher.close(); reject(new TypeError('authority never started')); }, 5000);
              const watcher = watch(home, (event, filename) => { if (filename === 'helper-started') { clearTimeout(timer); watcher.close(); resolve(); } });
            });
            const authorityHooks = await root.connectorServer({}, { providers: [], catalogReloadMs: 0, xaiOAuth: { mode: 'authority' } });
            try { await started; } finally { await authorityHooks.dispose(); }
            const pid = Number(await fs.readFile(home + '/helper-started', 'utf8'));
            let authority = false;
            try { process.kill(pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; authority = true; }
            process.stdout.write(JSON.stringify({ names, kinds, consumer, disabled, authority }));
          `,
      )
      const inspect = Bun.spawn([process.env["NODE_BIN"] ?? "node", inspectorPath], {
        cwd: projectRoot,
        env: { HOME: join(directory, "home"), PATH: process.env["PATH"] ?? "/usr/bin" },
        stderr: "pipe",
        stdout: "pipe",
      })
      const [inspectExitCode, stdout] = await Promise.all([
        inspect.exited,
        new Response(inspect.stdout).text(),
      ])

      // Then
      expect(inspectExitCode).toBe(0)
      expect(InspectionSchema.parse(JSON.parse(stdout))).toEqual({
        names: ["xaiAuthServer"],
        kinds: ["function"],
        consumer: [0, 1].map(() => ({
          provider: "xai",
          methods: [],
          sentinel: "xai-access-file",
          headers: ["Bearer synthetic-A", "Bearer synthetic-B"],
          text: "synthetic-result",
          disposed: true,
          authKeys: ["loader", "methods", "provider"],
        })),
        disabled: true,
        authority: true,
      })
    } finally {
      await packed?.cleanup()
      await rm(directory, { force: true, recursive: true })
    }
  }, 60_000)
})
