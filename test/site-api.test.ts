/**
 * The API reference pieces: overview pages (exports order, re-exports, `@module` descriptions),
 * the TypeDoc plugin (named return types, re-export records) and `defineXtandardSite`.
 *
 * @module
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiOverviews, moduleDescription, writeApiOverviews } from "../src/site/api-overviews.ts";
import {
  defineXtandardSite,
  orderedEntryPoints,
  toStarlightSidebar,
  type SitePeers,
} from "../src/site/define-site.ts";
import { defineSiteManifest, type SiteManifest } from "../src/site/manifest.ts";
import { createTypedocPlugin, readReexports, reexportsFile } from "../src/site/typedoc-plugin.ts";

const root = await mkdtemp(join(tmpdir(), "kit-site-api-"));
afterAll(() => rm(root, { recursive: true, force: true }));

let manifest: SiteManifest;
const apiDir = join(root, "site/src/content/docs/api");

async function write(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

const member = (title: string, summary: string) =>
  `---\ntitle: ${JSON.stringify(title)}\n---\n\nDefined in: x.ts:1\n\n${summary}\nsecond line.\n\n## Parameters\n`;

beforeAll(async () => {
  await write({
    "package.json": JSON.stringify({
      exports: {
        ".": "./dist/index.mjs",
        "./storage": "./dist/entry-storage.mjs",
        "./auth": "./dist/entry-auth.mjs",
      },
    }),
    "src/index.ts": `/**\n * The kit root: tiny utils. See {@link ./util | the utils} and {@linkcode Foo}.\n *\n * @module kit\n */\nexport { a } from "./entry-auth.ts";\n`,
    "src/entry-storage.ts":
      "/**\n * Storage contract.\n *\n * Import from `x`.\n * @module storage\n */\n",
    "src/entry-auth.ts": "// no doc comment\nexport const a = 1;\n",
    "site/src/content/docs/api/README.md": "generated root listing",
    "site/src/content/docs/api/kit/functions/a.md": member("a", "Does a | b."),
    "site/src/content/docs/api/kit/namespaces/NS/index.md": member("NS", "A namespace."),
    "site/src/content/docs/api/kit/namespaces/stray/x.txt": "",
    "site/src/content/docs/api/storage/interfaces/KvStorage.md": member(
      "KvStorage",
      "The contract.",
    ),
    "site/src/content/docs/api/storage/interfaces/notes.txt": "",
    "site/src/content/docs/api/auth/variables/a.md": '---\ntitle: "a"\n---\nno defined-in line\n',
    "site/src/content/docs/api/extra/thing/classes/C.md": member("C", "Orphan module."),
    "site/.astro/api-reexports.json": JSON.stringify([
      { module: "storage", name: "Helper", owner: "auth", kind: "functions", target: "helper" },
      { module: "kit", name: "a", owner: "auth", kind: "variables", target: "a" },
    ]),
  });
  manifest = defineSiteManifest({
    repoRoot: root,
    repoSlug: "o/kit",
    packageName: "@xtandard/kit",
    rootModule: "kit",
    base: "/xtandard-kit",
    sidebar: [{ label: "Start", items: [{ slug: "entry-points", site: "e.md" }] }],
    env: {},
  });
});

describe("apiOverviews", () => {
  it("writes /api/ and each module page in exports order", async () => {
    expect(writeApiOverviews(manifest, apiDir)).toBe(4);
    const index = await readFile(join(apiDir, "index.md"), "utf8");
    const rows = index.split("\n").filter((l) => l.startsWith("| [`"));
    expect(rows.map((r) => /\[`([^`]+)`\]/.exec(r)![1])).toEqual([
      "@xtandard/kit",
      "@xtandard/kit/storage",
      "@xtandard/kit/auth",
      "@xtandard/kit/extra/thing",
    ]);
    expect(index).toContain("[Entry points](/xtandard-kit/entry-points/)");
    expect(rows[0]).toContain("| 2 | The kit root: tiny utils.");

    const kit = await readFile(join(apiDir, "kit/index.md"), "utf8");
    expect(kit).toContain('title: "@xtandard/kit"');
    expect(kit).toContain("See `the utils` and `Foo`.");
    expect(kit).toContain('editUrl: "https://github.com/o/kit/edit/main/src/index.ts"');
    expect(kit).toContain(
      "Also re-exports symbols of [`@xtandard/kit/auth`](/xtandard-kit/api/auth/), documented on those pages.",
    );
    expect(kit).toContain(
      "| [`a`](/xtandard-kit/api/kit/functions/a/) | Does a \\| b. second line. |",
    );
    expect(kit).toContain(
      "| [`NS`](/xtandard-kit/api/kit/namespaces/ns/) | A namespace. second line. |",
    );
    expect(kit).not.toContain("## Re-exports"); // covered by the sentence above

    const storage = await readFile(join(apiDir, "storage/index.md"), "utf8");
    expect(storage).toContain("Storage contract.");
    expect(storage).not.toContain("Import from");
    expect(storage).toContain(
      "| [`Helper` (`helper`)](/xtandard-kit/api/auth/functions/helper/) | [`@xtandard/kit/auth`](/xtandard-kit/api/auth/) |",
    );
    // A generated module no entry matches (fl's writer read the repo root as a file: EISDIR).
    const extra = await readFile(join(apiDir, "extra/thing/index.md"), "utf8");
    expect(extra).toContain("editUrl: false");
    const auth = await readFile(join(apiDir, "auth/index.md"), "utf8");
    expect(auth).toContain('description: "API reference for @xtandard/kit/auth."');
    expect(auth).toContain("| [`a`](/xtandard-kit/api/auth/variables/a/) |  |");
  });

  it("omits the Entry points link when the site has none", async () => {
    writeApiOverviews(manifest, apiDir, { entryPointsSlug: false });
    expect(await readFile(join(apiDir, "index.md"), "utf8")).toContain(
      "listed in its\ndescription.",
    );
  });

  it("the Starlight plugin writes the pages on build and skips preview", () => {
    const plugin = apiOverviews(manifest);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const setup = plugin.hooks["config:setup"] as (ctx: unknown) => void;
    const astroConfig = { srcDir: new URL(`file://${join(root, "site/src")}/`) };
    setup({ astroConfig, command: "preview", logger });
    setup({ astroConfig, command: "build", logger });
    expect(logger.info).toHaveBeenCalledWith("API overviews: 4 modules");
    setup({ astroConfig: { srcDir: new URL("file:///nowhere/") }, command: "build", logger });
    expect(logger.warn).toHaveBeenCalledWith("no generated API reference to index");
  });

  it("moduleDescription handles a file without a doc comment", () => {
    expect(moduleDescription("export {};")).toBe("");
  });
});

describe("typedoc plugin", () => {
  it("records re-exports and keeps named return types", async () => {
    const { Application, ReflectionKind } = await import("typedoc");
    await write({
      "tdroot/tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ESNext",
          skipLibCheck: true,
        },
        include: ["*.ts"],
      }),
      "tdroot/owner.ts":
        "/** @module owner */\nexport type Plugin = { a: 1; b: 2 };\n/** Make one. */\nexport function make(): Plugin { return { a: 1, b: 2 }; }\n",
      "tdroot/other.ts": '/** @module other */\nexport { make } from "./owner.ts";\n',
      "tdroot/entry-bare.ts":
        "/**\n * Bare module tag.\n *\n * @module\n */\nexport const bare = 1;\n",
    });
    const siteDir = join(root, "tdsite");
    const app = await Application.bootstrapWithPlugins({
      entryPoints: [
        join(root, "tdroot/owner.ts"),
        join(root, "tdroot/other.ts"),
        join(root, "tdroot/entry-bare.ts"),
      ],
      tsconfig: join(root, "tdroot/tsconfig.json"),
      plugin: [
        createTypedocPlugin(siteDir, {
          moduleNames: { [join(root, "tdroot/entry-bare.ts")]: "storage/redis" },
        }),
      ] as never,
      skipErrorChecking: true,
      logLevel: "Error",
    });
    const project = await app.convert();
    expect(project).toBeDefined();
    const make = project!
      .getReflectionsByKind(ReflectionKind.Function)
      .find((r) => r.name === "make") as { signatures?: { type?: { toString(): string } }[] };
    expect(make.signatures?.[0]?.type?.toString()).toBe("Plugin");
    // A bare `@module` gets the subpath name, not the file name.
    expect(
      project!
        .getReflectionsByKind(ReflectionKind.Module)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["other", "owner", "storage/redis"]);
    expect(readReexports(siteDir)).toEqual([
      { module: "other", name: "make", owner: "owner", kind: "functions", target: "make" },
    ]);
    expect(reexportsFile(siteDir)).toBe(join(siteDir, ".astro/api-reexports.json"));
    expect(readReexports(join(root, "none"))).toEqual([]);
  }, 30_000);
});

describe("defineXtandardSite", () => {
  it("orders entry points with the owners first, and validates them", () => {
    expect(orderedEntryPoints(manifest, ["src/entry-storage.ts"])).toEqual([
      "src/entry-storage.ts",
      "src/entry-auth.ts",
      "src/index.ts",
    ]);
    expect(() => orderedEntryPoints(manifest, ["src/nope.ts"])).toThrow(/not an entry point/);
  });

  it("maps the manifest sidebar", () => {
    expect(
      toStarlightSidebar([
        { slug: "a" },
        { slug: "b", label: "B" },
        { label: "G", collapsed: true, items: [{ label: "npm", link: "https://x" }] },
      ]),
    ).toEqual([
      { slug: "a" },
      { slug: "b", label: "B" },
      { label: "G", collapsed: true, items: [{ label: "npm", link: "https://x" }] },
    ]);
  });

  it("assembles the Astro config from the injected integrations", async () => {
    const calls: Record<string, unknown> = {};
    const peers: SitePeers = {
      starlight: ((o: unknown) => ((calls.starlight = o), { name: "starlight" })) as never,
      createStarlightTypeDocPlugin: (() => [
        (o: unknown) => ((calls.typedoc = o), { name: "typedoc" }),
        { label: "API", items: [] },
      ]) as never,
      linksValidator: (o) => ((calls.links = o), { name: "links" }),
      mermaid: (o) => ((calls.mermaid = o), { name: "mermaid" }),
    };
    const config = await defineXtandardSite({
      manifest,
      description: "The kit.",
      tagline: "Shared building blocks",
      apiOwners: ["src/entry-storage.ts"],
      devPort: 4340,
      logo: false,
      peers,
    });
    expect(config).toMatchObject({
      site: "https://me.xantiagoma.com",
      base: "/xtandard-kit",
      server: { port: 4340 },
    });
    expect((config.integrations as { name: string }[]).map((i) => i.name)).toEqual([
      "mermaid",
      "starlight",
    ]);
    const sl = calls.starlight as Record<string, any>; // oxlint-disable-line typescript/no-explicit-any
    expect(sl.title).toBe("@xtandard/kit");
    expect(sl.logo).toBeUndefined();
    expect(sl.customCss).toEqual(["./src/styles/brand.css"]);
    expect(sl.sidebar.map((i: { label?: string; slug?: string }) => i.label)).toEqual([
      "API",
      "Start",
    ]);
    const head = JSON.stringify(sl.head);
    expect(head).toContain("16x16 32x32 48x48");
    expect(head).toContain('"theme-color","content":"#0f1215"');
    expect(head).toContain("@xtandard/kit — Shared building blocks");
    expect(head).toContain("https://me.xantiagoma.com/xtandard-kit/social.png");
    expect((calls.typedoc as { entryPoints: string[] }).entryPoints[0]).toBe(
      join(root, "src/entry-storage.ts"),
    );
    expect(calls.links).toMatchObject({ errorOnLocalLinks: false, errorOnInvalidHashes: true });
    const typeDoc = (calls.typedoc as { typeDoc: { plugin: unknown[] } }).typeDoc;
    expect(typeDoc.plugin[0]).toBe("typedoc-plugin-missing-exports");
    expect(typeDoc.plugin[1]).toBeTypeOf("function");

    await write({
      "docs/assets/lockup-horizontal-dark.svg": "<svg/>",
      "docs/assets/lockup-horizontal-light.svg": "<svg/>",
    });
    await defineXtandardSite({
      manifest,
      description: "d",
      tagline: "t",
      mermaid: false,
      brandCss: ["./a.css", "./b.css"],
      peers,
    });
    const again = calls.starlight as Record<string, any>; // oxlint-disable-line typescript/no-explicit-any
    expect(again.logo).toEqual({
      dark: "../docs/assets/lockup-horizontal-dark.svg",
      light: "../docs/assets/lockup-horizontal-light.svg",
      alt: "@xtandard/kit",
      replacesTitle: true,
    });
    expect(again.customCss).toEqual(["./a.css", "./b.css"]);

    // Only the brand files the site serves get head tags.
    await defineXtandardSite({
      manifest: { ...manifest, publicAssets: ["favicon.svg"] },
      description: "d",
      tagline: "t",
      mermaid: false,
      peers,
    });
    const bare = calls.starlight as Record<string, any>; // oxlint-disable-line typescript/no-explicit-any
    expect(bare.favicon).toBe("/favicon.svg");
    expect(JSON.stringify(bare.head)).not.toMatch(/favicon\.ico|apple-touch|og:image/);
  });
});
