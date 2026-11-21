import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { isMainModule } from "../src/cli/index.ts";
import { filePath, resolveUiDir } from "../src/server/static-assets.ts";

// Node 20.0–20.15 has no `process.getBuiltinModule`: the panel must still find a compiled SPA.
const proc = process as { getBuiltinModule?: unknown };
const original = proc.getBuiltinModule;
afterEach(() => {
  proc.getBuiltinModule = original;
});

describe("without process.getBuiltinModule (Node < 20.16)", () => {
  test("resolveUiDir assumes the compiled layout instead of giving up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kit-node20-"));
    try {
      await mkdir(join(dir, "dist", "ui"), { recursive: true });
      const moduleUrl = pathToFileURL(join(dir, "dist", "index.mjs"));
      const withBuiltins = resolveUiDir(moduleUrl);
      proc.getBuiltinModule = undefined;
      expect(resolveUiDir(moduleUrl)).toBe(withBuiltins);
      expect(resolveUiDir(moduleUrl)).toBe(join(dir, "dist", "ui"));
      expect(resolveUiDir("https://example.com/x.mjs")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isMainModule still recognises the entry point", () => {
    const argv1 = process.argv[1];
    process.argv[1] = "/srv/app/dist/cli.mjs";
    try {
      proc.getBuiltinModule = undefined;
      expect(isMainModule({ url: "file:///srv/app/dist/cli.mjs" })).toBe(true);
      expect(isMainModule({ url: "file:///srv/app/dist/other.mjs" })).toBe(false);
    } finally {
      process.argv[1] = argv1!;
    }
  });

  test("filePath decodes file URLs (POSIX and Windows drive letters)", () => {
    expect(filePath(new URL("file:///a/b%20c/d.mjs"))).toBe("/a/b c/d.mjs");
    expect(filePath(new URL("file:///C:/x/y.mjs"))).toBe("C:\\x\\y.mjs");
  });
});
