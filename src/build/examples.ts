/**
 * The example runner every product's `scripts/example.ts` shares (en's shape). The product supplies
 * the `EXAMPLES` table; the kit runs one example's server on a free port (or its non-interactive
 * demo), installs an example's own dependencies on first use, and runs every demo for `all --demo`.
 *
 * ```ts
 * // scripts/example.ts
 * import { createExampleRunner, type ExampleConfig } from "@xtandard/kit/build";
 * export const EXAMPLES: Record<string, ExampleConfig> = { hono: { … }, … };
 * if (import.meta.main) process.exit(await createExampleRunner(EXAMPLES).main(process.argv.slice(2)));
 * ```
 *
 * @module
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/** How one example is run. */
export interface ExampleConfig {
  /** The example directory, relative to the repo root. */
  dir: string;
  /** A server (gets a free `PORT`) or a script. */
  kind: "server" | "script";
  /** Command for the interactive run (in the example dir). */
  run: string[];
  /**
   * Command for the non-interactive demo (in the example dir). Exits 0 on success. Without one, the
   * example has no demo: `<name> --demo` fails and `all --demo` skips it.
   */
  demo?: string[];
  /** Command run once before the interactive run (in the example dir), e.g. seeding data. */
  seed?: string[];
  /** `bun install` the example on first use: always, or only for the interactive run. */
  install?: "always" | "run";
  /** Preferred port for server examples; a nearby free one is used if taken. */
  preferredPort?: number;
  /** Path the admin panel is mounted at, for the printed URL. */
  panelPath?: string;
  /** External requirement or hint to surface before running. */
  note?: string;
}

/** Run `cmd` in `cwd` with extra `env`, inheriting stdio; resolve with the exit code. */
export type SpawnLike = (
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
) => Promise<number>;

/** Options for {@link createExampleRunner}. */
export interface ExampleRunnerOptions {
  /** Process spawner; inherits stdio by default. */
  spawn?: SpawnLike;
  /** Free-port finder (`preferred`, then upwards); a TCP probe by default. */
  getPort?: (preferred: number) => Promise<number>;
  /** Where messages go; `console.log` by default. */
  log?: (line: string) => void;
  /** Where errors go; `console.error` by default. */
  error?: (line: string) => void;
  /** Directory checked for the built admin UI; `"dist/ui"` by default. */
  uiDir?: string;
}

/** What {@link createExampleRunner} returns. */
export interface ExampleRunner {
  /** Run one example (`demo` = the non-interactive demo). Resolves with the exit code. */
  runExample(name: string, demo: boolean): Promise<number>;
  /** Run every demo in sequence; resolves with the failed names. */
  runAllDemos(): Promise<string[]>;
  /** CLI entry: `<name> [--demo]` or `all --demo`. Resolves with the exit code. */
  main(argv: string[]): Promise<number>;
}

const defaultSpawn: SpawnLike = (cmd, cwd, env) =>
  new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    if (!bin) return reject(new Error("empty command"));
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    const stop = () => child.kill();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve(code ?? (signal ? 1 : 0));
    });
  });

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

/** The first free TCP port in `[preferred, preferred + range]`. */
export async function findFreePort(preferred: number, range = 200): Promise<number> {
  for (let port = preferred; port <= preferred + range; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port in ${preferred}-${preferred + range}`);
}

/** Build the runner for a product's `EXAMPLES` table. */
export function createExampleRunner(
  examples: Record<string, ExampleConfig>,
  options: ExampleRunnerOptions = {},
): ExampleRunner {
  const sh = options.spawn ?? defaultSpawn;
  const getPort = options.getPort ?? ((p: number) => findFreePort(p));
  const log = options.log ?? ((l: string) => console.log(l));
  const error = options.error ?? ((l: string) => console.error(l));
  const uiDir = options.uiDir ?? "dist/ui";

  async function ensureInstalled(name: string, cfg: ExampleConfig, demo: boolean) {
    const needed = cfg.install === "always" || (cfg.install === "run" && !demo);
    if (!needed || existsSync(join(cfg.dir, "node_modules"))) return 0;
    log(`Installing ${name} dependencies …`);
    return sh(["bun", "install"], cfg.dir);
  }

  async function runExample(name: string, demo: boolean): Promise<number> {
    const cfg = examples[name];
    if (!cfg) throw new Error(`Unknown example "${name}"`);
    if (cfg.note) log(`ℹ︎  ${name}: ${cfg.note}`);
    const installed = await ensureInstalled(name, cfg, demo);
    if (installed !== 0) return installed;
    if (demo) {
      if (!cfg.demo) {
        error(`Example "${name}" has no non-interactive demo.`);
        return 1;
      }
      return sh(cfg.demo, cfg.dir);
    }
    if (cfg.seed) {
      log(`Seeding ${name} …`);
      const seeded = await sh(cfg.seed, cfg.dir);
      if (seeded !== 0) return seeded;
    }

    const env: Record<string, string> = {};
    if (cfg.kind === "server") {
      if (!existsSync(uiDir)) {
        log(
          `ℹ︎  ${uiDir} is missing — the API works, but build once to see the admin UI: bun run build`,
        );
      }
      const port = await getPort(cfg.preferredPort ?? 3000);
      env.PORT = String(port);
      log(`▶  ${name} → http://localhost:${port}${cfg.panelPath ?? ""}`);
    }
    return sh(cfg.run, cfg.dir, env);
  }

  async function runAllDemos(): Promise<string[]> {
    // Sequential: the demos share nothing, but sequential output reads better.
    const failed: string[] = [];
    for (const key of Object.keys(examples)) {
      if (!examples[key]!.demo) continue; // no non-interactive demo
      log(`\n━━━ ${key} ━━━`);
      if ((await runExample(key, true)) !== 0) failed.push(key);
    }
    if (failed.length) error(`\nFailed demos: ${failed.join(", ")}`);
    return failed;
  }

  async function main(argv: string[]): Promise<number> {
    const demo = argv.includes("--demo");
    const name = argv.find((a) => !a.startsWith("--"));
    if (name === "all" && demo) return (await runAllDemos()).length ? 1 : 0;
    if (!name || !examples[name]) {
      error(
        `Unknown example "${name ?? ""}". Available: ${Object.keys(examples).join(", ")} (or "all --demo")`,
      );
      return 1;
    }
    return runExample(name, demo);
  }

  return { runExample, runAllDemos, main };
}
