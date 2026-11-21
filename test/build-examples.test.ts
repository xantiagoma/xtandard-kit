/**
 * The example runner (en's shape): server examples get a free port, demos run as-is, `all --demo`
 * runs every demo, first-use installs.
 *
 * @module
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createExampleRunner,
  findFreePort,
  type ExampleConfig,
  type SpawnLike,
} from "../src/build/examples.ts";

const dir = await mkdtemp(join(tmpdir(), "kit-examples-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

function harness(examples: Record<string, ExampleConfig>, codes: Record<string, number> = {}) {
  const calls: { cmd: string; cwd: string; env?: Record<string, string> }[] = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const spawn: SpawnLike = async (cmd, cwd, env) => {
    calls.push({ cmd: cmd.join(" "), cwd, env });
    return codes[`${cwd}:${cmd.join(" ")}`] ?? 0;
  };
  const runner = createExampleRunner(examples, {
    spawn,
    getPort: async (p) => p + 1,
    log: (l) => lines.push(l),
    error: (l) => errors.push(l),
    uiDir: join(dir, "no-ui"),
  });
  return { runner, calls, lines, errors };
}

const hono: ExampleConfig = {
  dir: "examples/hono",
  kind: "server",
  run: ["bun", "src/index.ts"],
  demo: ["bun", "src/demo.ts"],
  preferredPort: 3000,
  panelPath: "/billing",
};
const script: ExampleConfig = {
  dir: "examples/drivers",
  kind: "script",
  run: ["bun", "src/demo.ts"],
  demo: ["bun", "src/demo.ts"],
  note: "needs nothing",
};

describe("createExampleRunner", () => {
  it("runs a server on a free port and prints its URL", async () => {
    const h = harness({ hono });
    expect(await h.runner.main(["hono"])).toBe(0);
    expect(h.calls).toEqual([
      { cmd: "bun src/index.ts", cwd: "examples/hono", env: { PORT: "3001" } },
    ]);
    expect(h.lines.join("\n")).toContain("http://localhost:3001/billing");
    expect(h.lines.join("\n")).toContain("no-ui is missing");
  });

  it("runs the demo for --demo, scripts without a port, and shows notes", async () => {
    const h = harness({ hono, script });
    expect(await h.runner.main(["hono", "--demo"])).toBe(0);
    expect(await h.runner.main(["script"])).toBe(0);
    expect(h.calls.map((c) => c.cmd)).toEqual(["bun src/demo.ts", "bun src/demo.ts"]);
    expect(h.calls[1]!.env).toEqual({});
    expect(h.lines).toContain("ℹ︎  script: needs nothing");
  });

  it("all --demo runs every demo and fails when one fails", async () => {
    const h = harness({ hono, script }, { "examples/drivers:bun src/demo.ts": 3 });
    expect(await h.runner.main(["all", "--demo"])).toBe(1);
    expect(h.calls.map((c) => c.cwd)).toEqual(["examples/hono", "examples/drivers"]);
    expect(h.errors.join("")).toContain("Failed demos: script");
    const ok = harness({ hono });
    expect(await ok.runner.main(["all", "--demo"])).toBe(0);
  });

  it("seed runs before the interactive run; examples without a demo are skipped by all --demo", async () => {
    const sdk: ExampleConfig = {
      dir: "examples/flags-sdk",
      kind: "server",
      seed: ["bun", "seed.ts"],
      run: ["bun", "dev"],
    };
    const h = harness({ sdk, hono });
    expect(await h.runner.main(["sdk"])).toBe(0);
    expect(h.calls.map((c) => c.cmd)).toEqual(["bun seed.ts", "bun dev"]);
    expect(await h.runner.main(["sdk", "--demo"])).toBe(1);
    expect(h.errors.join("")).toContain('"sdk" has no non-interactive demo');
    const all = harness({ sdk, hono });
    expect(await all.runner.main(["all", "--demo"])).toBe(0);
    expect(all.calls.map((c) => c.cwd)).toEqual(["examples/hono"]);
    const failingSeed = harness({ sdk }, { "examples/flags-sdk:bun seed.ts": 2 });
    expect(await failingSeed.runner.main(["sdk"])).toBe(2);
    expect(failingSeed.calls.map((c) => c.cmd)).toEqual(["bun seed.ts"]);
  });

  it("rejects unknown examples", async () => {
    const h = harness({ hono });
    expect(await h.runner.main(["nope"])).toBe(1);
    expect(await h.runner.main([])).toBe(1);
    expect(await h.runner.main(["all"])).toBe(1);
    expect(h.errors[0]).toContain('Unknown example "nope". Available: hono');
    await expect(h.runner.runExample("nope", false)).rejects.toThrow(/Unknown example/);
  });

  it("installs an example's own deps on first use", async () => {
    const next: ExampleConfig = { ...hono, dir: join(dir, "next"), install: "run" };
    const always: ExampleConfig = { ...script, dir: join(dir, "always"), install: "always" };
    await mkdir(next.dir, { recursive: true });
    const h = harness({ next, always }, { [`${always.dir}:bun install`]: 7 });
    expect(await h.runner.main(["next", "--demo"])).toBe(0); // demo needs no install
    expect(await h.runner.main(["next"])).toBe(0);
    expect(await h.runner.main(["always", "--demo"])).toBe(7); // install failed
    expect(h.calls.map((c) => c.cmd)).toEqual([
      "bun src/demo.ts",
      "bun install",
      "bun src/index.ts",
      "bun install",
    ]);
    await mkdir(join(next.dir, "node_modules"));
    h.calls.length = 0;
    expect(await h.runner.main(["next"])).toBe(0);
    expect(h.calls.map((c) => c.cmd)).toEqual(["bun src/index.ts"]);
  });

  it("the default spawner runs a real process and returns its exit code", async () => {
    const runner = createExampleRunner(
      { s: { ...script, dir, demo: [process.execPath, "-e", "process.exit(4)"] } },
      { log: () => {} },
    );
    expect(await runner.runExample("s", true)).toBe(4);
  });
});

describe("findFreePort", () => {
  it("skips a taken port", async () => {
    const server = createServer();
    const port = await new Promise<number>((resolve) =>
      server.listen(0, () => resolve((server.address() as { port: number }).port)),
    );
    try {
      const free = await findFreePort(port, 50);
      expect(free).toBeGreaterThan(port);
      await expect(findFreePort(port, 0)).rejects.toThrow(/no free port/);
    } finally {
      server.close();
    }
  });
});
