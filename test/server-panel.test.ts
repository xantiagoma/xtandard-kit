import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBasePath, stripBasePath } from "../src/server/base-path.ts";
import { applyCorsHeaders, preflightResponse } from "../src/server/cors.ts";
import { createPanelHandler, intervalTask } from "../src/server/panel.ts";
import { renderIndexHtml } from "../src/server/render-index-html.ts";
import { looksLikeAsset, resolveUiDir, serveStaticAsset } from "../src/server/static-assets.ts";

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

async function makeUi(): Promise<string> {
  const uiDir = join(tmp("kit-ui-"), "ui");
  await mkdir(join(uiDir, "assets"), { recursive: true });
  await writeFile(join(uiDir, "assets", "app.js"), "console.log(1)");
  await writeFile(join(uiDir, "favicon.ico"), "icon");
  await writeFile(join(uiDir, "blob.xyz"), "?");
  await writeFile(
    join(uiDir, "index.html"),
    "<!doctype html><html><head><title>t</title></head><body></body></html>",
  );
  return uiDir;
}

describe("base-path", () => {
  it("normalizes assorted inputs to a canonical form", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("webhooks")).toBe("/webhooks");
    expect(normalizeBasePath(" /webhooks/ ")).toBe("/webhooks");
  });

  it("strips the base path from a pathname", () => {
    expect(stripBasePath("/webhooks/api/config", "/webhooks")).toBe("/api/config");
    expect(stripBasePath("/webhooks", "/webhooks")).toBe("/");
    expect(stripBasePath("/api/config", "")).toBe("/api/config");
    expect(stripBasePath("", "")).toBe("/");
    expect(stripBasePath("/other/x", "/webhooks")).toBe("/other/x");
    expect(stripBasePath("/webhooksx", "/webhooks")).toBe("/webhooksx");
  });
});

describe("static assets", () => {
  it("looksLikeAsset is true only when the last segment has a dot", () => {
    expect(looksLikeAsset("/assets/app.js")).toBe(true);
    expect(looksLikeAsset("/deliveries/dlv_1")).toBe(false);
    expect(looksLikeAsset("/")).toBe(false);
  });

  it("serves files with content types and cache headers", async () => {
    const uiDir = await makeUi();
    const js = await serveStaticAsset(uiDir, "/assets/app.js");
    expect(js?.status).toBe(200);
    expect(js?.headers.get("content-type")).toContain("text/javascript");
    expect(js?.headers.get("cache-control")).toContain("immutable");
    const ico = await serveStaticAsset(uiDir, "/favicon.ico");
    expect(ico?.headers.get("content-type")).toBe("image/x-icon");
    expect(ico?.headers.get("cache-control")).toBe("no-cache");
    const unknown = await serveStaticAsset(uiDir, "/blob.xyz");
    expect(unknown?.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("returns null for missing files, directories and traversal (incl. prefix-sharing siblings)", async () => {
    const uiDir = await makeUi();
    await mkdir(`${uiDir}-private`, { recursive: true });
    await writeFile(join(`${uiDir}-private`, "secret.txt"), "secret");
    expect(await serveStaticAsset(uiDir, "/nope.js")).toBeNull();
    expect(await serveStaticAsset(uiDir, "/assets")).toBeNull();
    expect(await serveStaticAsset(uiDir, "/../../etc/passwd")).toBeNull();
    expect(await serveStaticAsset(uiDir, "/../ui-private/secret.txt")).toBeNull();
    expect(await serveStaticAsset(uiDir, "/a/../../ui-private/secret.txt")).toBeNull();
  });

  it("resolveUiDir prefers an existing candidate, then the compiled layout", async () => {
    const root = tmp("kit-resolve-");
    await mkdir(join(root, "dist", "ui"), { recursive: true });
    await mkdir(join(root, "src", "server"), { recursive: true });
    // Running from source: src/server/x.ts → <repo>/dist/ui.
    const fromSource = pathToFileURL(join(root, "src", "server", "x.ts"));
    expect(resolveUiDir(fromSource)).toBe(join(root, "dist", "ui"));
    // Compiled: dist/chunk.mjs → dist/ui (sibling).
    const compiled = pathToFileURL(join(root, "dist", "chunk.mjs"));
    expect(resolveUiDir(compiled)).toBe(join(root, "dist", "ui"));
    // Nothing built: the compiled-layout path, so the "build the UI" hint fires.
    const empty = tmp("kit-resolve-empty-");
    const bare = pathToFileURL(join(empty, "a", "b", "x.mjs"));
    expect(resolveUiDir(bare)).toBe(join(empty, "a", "b", "ui"));
    await mkdir(join(root, "dist", "custom"), { recursive: true });
    expect(resolveUiDir(fromSource, ["../../dist/custom"])).toBe(join(root, "dist", "custom"));
    expect(resolveUiDir("https://example.com/x.mjs")).toBeUndefined();
  });

  it("resolveUiDir is undefined without a Node-like runtime (Workers)", () => {
    // Workers without nodejs_compat: no Node `process`, so no built-ins now or later.
    const g = globalThis as { process?: unknown };
    const real = g.process;
    g.process = { env: {} };
    try {
      expect(resolveUiDir(import.meta.url)).toBeUndefined();
    } finally {
      g.process = real;
    }
  });
});

describe("renderIndexHtml", () => {
  const options = (config: Record<string, unknown> = {}) => ({
    globalName: "__WEBHOOKS_CONFIG__",
    config: { title: "Panel", basePath: "/webhooks", ...config },
  });

  it("injects <base> and the bootstrap into the built index.html", async () => {
    const html = await renderIndexHtml(await makeUi(), options({ readonly: true }));
    expect(html).toContain(
      '<head><base href="/webhooks/"><script>window.__WEBHOOKS_CONFIG__={"title":"Panel","basePath":"/webhooks","readonly":true}</script>',
    );
  });

  it("escapes the title, the base href and the bootstrap JSON", async () => {
    // Regression: wh/fl/au wrote the title raw into <title>/<h1> (HTML injection), and only li
    // escaped the base href and U+2028 in the bootstrap.
    const html = await renderIndexHtml(
      undefined,
      options({
        title: '<img src=x onerror=alert(1)>"',
        basePath: '/a"><script>x()</script>',
        note: "a b</script>",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("<title>&#60;img src=x onerror=alert(1)&#62;&#34;</title>");
    expect(html).toContain('<base href="/a&#34;&#62;&#60;script&#62;x()&#60;/script&#62;/">');
    expect(html).not.toContain("</script>x");
    expect(html).toContain("a\\u2028b\\u003c/script\\u003e");
    expect(html).not.toContain(" ");
  });

  it("keeps `$` sequences in the bootstrap intact", async () => {
    // Regression: String#replace with a string treated `$&`/`$'` in the JSON as patterns.
    const html = await renderIndexHtml(await makeUi(), options({ title: "a $& b $' c" }));
    expect(html).toContain('"title":"a $& b $\' c"');
  });

  it("falls back to a built-in page (no UI dir, missing index, or no <head>)", async () => {
    const fallback = await renderIndexHtml(tmp("kit-empty-"), options());
    expect(fallback).toContain('<html lang="en">');
    expect(fallback).toContain("bun run build:ui");
    expect(fallback).toContain('href="api/openapi.json"');
    expect(await renderIndexHtml(undefined, options())).toBe(fallback);
    const noHead = join(tmp("kit-nohead-"), "ui");
    await mkdir(noHead, { recursive: true });
    await writeFile(join(noHead, "index.html"), "<p>hi</p>");
    expect(await renderIndexHtml(noHead, options())).toMatch(
      /^<base href="\/webhooks\/"><script>.*<p>hi<\/p>$/,
    );
  });

  it("rejects a globalName that is not an identifier", async () => {
    await expect(
      renderIndexHtml(undefined, { globalName: "x;alert(1)", config: { title: "", basePath: "" } }),
    ).rejects.toThrow("globalName must be an identifier");
  });
});

describe("cors", () => {
  const req = (origin?: string, method = "GET", headers: Record<string, string> = {}) =>
    new Request("http://panel/x", {
      method,
      headers: { ...(origin ? { origin } : {}), ...headers },
    });

  it("allows listed origins, a predicate, and `*`", () => {
    const one = applyCorsHeaders(req("https://a.com"), new Response("x"), {
      origin: "https://a.com",
    });
    expect(one.headers.get("access-control-allow-origin")).toBe("https://a.com");
    expect(one.headers.get("vary")).toBe("Origin");
    const list = applyCorsHeaders(req("https://b.com"), new Response("x"), {
      origin: ["https://a.com", "https://b.com"],
    });
    expect(list.headers.get("access-control-allow-origin")).toBe("https://b.com");
    const fn = applyCorsHeaders(req("https://c.com"), new Response("x"), {
      origin: (o) => o.endsWith(".com"),
    });
    expect(fn.headers.get("access-control-allow-origin")).toBe("https://c.com");
    const star = applyCorsHeaders(req("https://d.com"), new Response("x"), { origin: "*" });
    expect(star.headers.get("access-control-allow-origin")).toBe("*");
    expect(star.headers.get("vary")).toBeNull();
  });

  it("denies other origins and requests without Origin", () => {
    const denied = applyCorsHeaders(req("https://evil.com"), new Response("x"), {
      origin: "https://a.com",
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    const none = applyCorsHeaders(req(), new Response("x"), { origin: ["https://a.com"] });
    expect(none.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("`*` with credentials echoes the origin", () => {
    const res = applyCorsHeaders(req("https://a.com"), new Response("x"), {
      origin: "*",
      credentials: true,
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://a.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const noOrigin = applyCorsHeaders(req(), new Response("x"), { origin: "*", credentials: true });
    expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("decorates responses with immutable headers (Response.redirect)", () => {
    const res = applyCorsHeaders(req("https://a.com"), Response.redirect("https://x.com/", 302), {
      origin: "https://a.com",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://x.com/");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://a.com");
  });

  it("preflight: defaults, reflected headers, explicit lists and max-age", () => {
    const pre = preflightResponse(
      req("https://a.com", "OPTIONS", { "access-control-request-headers": "x-custom" }),
      { origin: "https://a.com" },
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toBe(
      "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS",
    );
    expect(pre.headers.get("access-control-allow-headers")).toBe("x-custom");
    const plain = preflightResponse(req("https://a.com", "OPTIONS"), { origin: "https://a.com" });
    expect(plain.headers.get("access-control-allow-headers")).toBe("Content-Type, Authorization");
    const custom = preflightResponse(req("https://a.com", "OPTIONS"), {
      origin: "https://a.com",
      methods: ["GET"],
      headers: ["X-A", "X-B"],
      maxAge: 600,
    });
    expect(custom.headers.get("access-control-allow-methods")).toBe("GET");
    expect(custom.headers.get("access-control-allow-headers")).toBe("X-A,X-B");
    expect(custom.headers.get("access-control-max-age")).toBe("600");
  });
});

describe("createPanelHandler", () => {
  const base = { title: "Panel", globalName: "__KIT_CONFIG__", basePath: "/panel" };
  const get = (path: string, init?: RequestInit) => new Request(`http://host${path}`, init);

  it("serves the healthcheck inside the panel, under the base path", async () => {
    // Regression: wh/fl/au only had /healthcheck in the CLI, so embedded panels had none.
    const panel = createPanelHandler(base);
    const res = await panel.fetch(get("/panel/healthcheck"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(panel.basePath).toBe("/panel");
    const off = createPanelHandler({ ...base, healthcheck: false });
    expect((await off.fetch(get("/panel/healthcheck"))).headers.get("content-type")).toContain(
      "text/html",
    );
  });

  it("routes to the product API first, then OpenAPI, then the UI", async () => {
    const api = vi.fn(async (_req: Request, path: string) =>
      path.startsWith("/api/items") ? new Response("items") : null,
    );
    const panel = createPanelHandler({ ...base, api, openapi: () => ({ openapi: "3.1.0" }) });
    expect(await (await panel.fetch(get("/panel/api/items"))).text()).toBe("items");
    expect(api).toHaveBeenCalledWith(expect.any(Request), "/api/items");
    expect(await (await panel.fetch(get("/panel/api/openapi.json"))).json()).toEqual({
      openapi: "3.1.0",
    });
    expect(await (await panel.fetch(get("/panel/openapi.json"))).json()).toEqual({
      openapi: "3.1.0",
    });
    const noDoc = createPanelHandler(base);
    expect((await noDoc.fetch(get("/panel/openapi.json"))).status).toBe(404);
  });

  it("405 for writes to non-API paths", async () => {
    const panel = createPanelHandler({ ...base, api: () => null });
    const res = await panel.fetch(get("/panel/somewhere", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves assets, 404s missing asset-like paths, falls back to the SPA with no-cache", async () => {
    // Regression: only links sent `cache-control: no-cache` on the SPA HTML, so other panels
    // could serve a stale index.html that references deleted hashed assets after an upgrade.
    const uiDir = await makeUi();
    const panel = createPanelHandler({
      ...base,
      uiDir,
      readonly: true,
      logoUrl: "/logo.svg",
      bootstrap: () => ({ version: "1.2.3" }),
    });
    expect((await panel.fetch(get("/panel/assets/app.js"))).status).toBe(200);
    expect((await panel.fetch(get("/panel/assets/gone.js"))).status).toBe(404);
    const spa = await panel.fetch(get("/panel/deliveries/dlv_1"));
    expect(spa.status).toBe(200);
    expect(spa.headers.get("cache-control")).toBe("no-cache");
    expect(spa.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await spa.text()).toContain(
      'window.__KIT_CONFIG__={"title":"Panel","basePath":"/panel","readonly":true,"logoUrl":"/logo.svg","version":"1.2.3"}',
    );
    expect((await panel.fetch(get("/panel"))).status).toBe(200);
  });

  it("without a uiDir (Workers) it serves the fallback page", async () => {
    const panel = createPanelHandler(base);
    const res = await panel.fetch(get("/panel/"));
    expect(await res.text()).toContain("bun run build:ui");
    expect((await panel.fetch(get("/panel/app.js"))).status).toBe(404);
  });

  it("answers preflights and decorates every response when cors is set", async () => {
    const panel = createPanelHandler({ ...base, cors: { origin: "https://app.com" } });
    const pre = await panel.fetch(
      get("/panel/api/x", { method: "OPTIONS", headers: { origin: "https://app.com" } }),
    );
    expect(pre.status).toBe(204);
    const res = await panel.fetch(
      get("/panel/healthcheck", { headers: { origin: "https://app.com" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.com");
  });

  it("starts tasks and stops them once on close()", async () => {
    const started: string[] = [];
    const stop = vi.fn(async () => undefined);
    const panel = createPanelHandler({
      ...base,
      tasks: [{ start: () => started.push("a"), stop }, { stop: () => undefined }],
    });
    expect(started).toEqual(["a"]);
    await Promise.all([panel.close(), panel.close()]);
    await panel.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("intervalTask", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs on the interval, reports failures, and stops", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("boom"));
    const onError = vi.fn();
    const task = intervalTask("1s", run, { onError });
    task.start?.();
    task.start?.(); // idempotent
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(new Error("boom"));
    task.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("the default reporter warns with the source; every <= 0 never runs", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const task = intervalTask(
      10,
      () => {
        throw new Error("sync boom");
      },
      { source: "@xtandard/entitlements" },
    );
    task.start?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(warn).toHaveBeenCalledWith(
      "[@xtandard/entitlements] task failed:",
      new Error("sync boom"),
    );
    task.stop();
    const idle = vi.fn();
    const never = intervalTask(0, idle);
    never.start?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(idle).not.toHaveBeenCalled();
    never.stop();
    intervalTask(10, () => undefined).stop();
    warn.mockRestore();
  });
});
