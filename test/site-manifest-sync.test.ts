/**
 * The site manifest (pages, pruned pending guides, entries) and the sync step (fl's version plus
 * au's pending design): titles and descriptions from the source, split guides, link rewriting,
 * alerts, site-only pages, public assets and the "every guide is a page" check.
 *
 * @module
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  apiEntries,
  defineSiteManifest,
  type SiteItem,
  type SiteManifestOptions,
} from "../src/site/manifest.ts";
import { describeMarkdown, runSync, Slugger, syncSite } from "../src/site/sync.ts";

const tmp = await mkdtemp(join(tmpdir(), "kit-site-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

let root: string;
let n = 0;

async function write(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

const README = `<p align="center"><img src="docs/assets/logo.svg"></p>

# @xtandard/demo

Self-hosted demo control plane. It does things.

## Why

Because. See [storage](docs/STORAGE.md#drivers) and [the guide](./docs/GUIDE.md).

## Quickstart

\`\`\`sh
bun add @xtandard/demo # [not a link](docs/NOPE.md)
\`\`\`

> [!WARNING]
> Careful \`[x](y)\` here.

## Not on the site

Stays on GitHub.
`;

const STORAGE = `# Storage

---

Drivers and more.

## Drivers

See [why](../README.md#why), [the source](../src/index.ts) and [the tests](../test/).

### Redis!

![diagram](./assets/d.png) and [a pending guide](./FUTURE.md#x).

## Watch

Back to [drivers](#drivers) and [redis](#redis).
`;

function sidebar(extra: SiteItem[] = []): SiteItem[] {
  return [
    {
      label: "Start",
      items: [
        { slug: "why", src: "README.md", sections: ["Why"], title: "Why demo" },
        { slug: "quickstart", src: "README.md", sections: ["Quickstart"] },
      ],
    },
    {
      label: "Guides",
      items: [
        { slug: "storage", src: "docs/STORAGE.md", sections: ["Drivers"], intro: true },
        { slug: "storage/watch", src: "docs/STORAGE.md", sections: ["Watch"] },
        { slug: "guide", src: "docs/GUIDE.md", label: "Guide", internal: true },
        { slug: "future", src: "docs/FUTURE.md", pending: true },
        ...extra,
      ],
    },
    { label: "Project", items: [{ label: "npm", link: "https://npm.im/x" }] },
  ];
}

function options(over: Partial<SiteManifestOptions> = {}): SiteManifestOptions {
  return {
    repoRoot: root,
    repoSlug: "xantiagoma/xtandard-demo",
    packageName: "@xtandard/demo",
    base: "/xtandard-demo/",
    sidebar: sidebar(),
    env: {},
    ...over,
  };
}

beforeEach(async () => {
  root = join(tmp, `repo-${n++}`);
  await write({
    "README.md": README,
    "docs/STORAGE.md": STORAGE,
    "docs/GUIDE.md": "# Guide\n\nThe guide.\n",
    "docs/assets/d.png": "png",
    "docs/assets/favicon.svg": "<svg/>",
    "docs/assets/favicon.ico": "ico",
    "docs/assets/apple-touch-icon.png": "png",
    "docs/assets/social.png": "png",
    "src/index.ts": "export {};",
    "test/x.test.ts": "",
    "site/content/index.mdx":
      "---\ntitle: Home\n---\n\n[Repo](@REPO@) · [Docs](@BASE@/why/) · @NPM@\n",
    "package.json": JSON.stringify({
      name: "@xtandard/demo",
      exports: {
        ".": "./dist/index.mjs",
        "./storage": "./dist/entry-storage.mjs",
        "./react": "./dist/react.js",
        "./react/styles.css": "./dist/react.css",
        "./ui/*": "./dist/ui/*",
        "./package.json": "./package.json",
      },
    }),
    "src/entry-storage.ts": "export {};",
    "src/storage.ts": "export {};",
    "src/react.tsx": "export {};",
  });
});

describe("defineSiteManifest", () => {
  it("resolves URLs, the base and origin (https, env overrides)", () => {
    const m = defineSiteManifest(options());
    expect(m.siteBase).toBe("/xtandard-demo");
    expect(m.siteOrigin).toBe("https://me.xantiagoma.com");
    expect(m.repoUrl).toBe("https://github.com/xantiagoma/xtandard-demo");
    expect(m.npmUrl).toBe("https://www.npmjs.com/package/@xtandard/demo");
    expect(m.rootModule).toBe("demo");
    expect(m.siteDir).toBe(join(root, "site"));
    const env = defineSiteManifest(
      options({ env: { SITE_ORIGIN: "http://docs.example.com/", SITE_BASE: "/d/" } }),
    );
    expect(env.siteOrigin).toBe("https://docs.example.com");
    expect(env.siteBase).toBe("/d");
  });

  it("leaves pending guides out until their source exists", async () => {
    const m = defineSiteManifest(options());
    expect(m.pages().map((p) => p.slug)).toEqual([
      "",
      "why",
      "quickstart",
      "storage",
      "storage/watch",
      "guide",
    ]);
    expect(m.pendingPages().map((p) => p.slug)).toEqual(["future"]);
    await write({ "docs/FUTURE.md": "# Future\n\n## X\n" });
    const landed = defineSiteManifest(options());
    expect(landed.pages().map((p) => p.slug)).toContain("future");
    expect(landed.pendingPages()).toEqual([]);
  });

  it("drops a group left empty by pending pages", () => {
    const m = defineSiteManifest(
      options({
        sidebar: [{ label: "Soon", items: [{ slug: "x", src: "docs/X.md", pending: true }] }],
      }),
    );
    expect(m.sidebar).toEqual([]);
  });

  it("apiEntries: exports order, entry-* before src/<sub>, code exports only", () => {
    expect(apiEntries(root, "@xtandard/demo", "demo")).toEqual([
      { name: "demo", importPath: "@xtandard/demo", source: "src/index.ts" },
      { name: "storage", importPath: "@xtandard/demo/storage", source: "src/entry-storage.ts" },
      { name: "react", importPath: "@xtandard/demo/react", source: "src/react.tsx" },
    ]);
  });

  it("apiEntries fails loudly for an export without a source", async () => {
    await write({ "package.json": JSON.stringify({ exports: { "./nope": "./dist/nope.mjs" } }) });
    expect(() => defineSiteManifest(options()).apiEntries()).toThrow(/"\.\/nope" export/);
  });
});

describe("syncSite", () => {
  const read = (slug: string) =>
    readFile(join(root, "site/src/content/docs", `${slug}.md`), "utf8");

  it("writes the pages with titles, descriptions, rewritten links and asides", async () => {
    const result = syncSite(defineSiteManifest(options()));
    expect(result.errors).toEqual([]);
    expect(result.written).toBe(6);
    expect(result.warnings).toEqual([
      "docs/STORAGE.md: ./FUTURE.md#x is a pending guide; linking to GitHub until it lands",
    ]);

    const why = await read("why");
    expect(why).toContain('title: "Why demo"');
    expect(why).toContain('description: "Because. See storage and the guide."');
    expect(why).toContain(
      'editUrl: "https://github.com/xantiagoma/xtandard-demo/edit/main/README.md"',
    );
    expect(why).not.toContain("## Why");
    expect(why).toContain("[storage](/xtandard-demo/storage/#drivers)");
    expect(why).toContain("[the guide](/xtandard-demo/guide/)");

    const quick = await read("quickstart");
    expect(quick).toContain("bun add @xtandard/demo # [not a link](docs/NOPE.md)"); // code untouched
    expect(quick).toContain(":::caution\nCareful `[x](y)` here.\n:::");

    const storage = await read("storage");
    expect(storage).toContain('title: "Storage"');
    expect(storage).toContain('description: "Drivers and more."'); // thematic break skipped
    expect(storage).toContain("## Drivers");
    expect(storage).toContain("[why](/xtandard-demo/why/)");
    expect(storage).toContain(
      "[the source](https://github.com/xantiagoma/xtandard-demo/blob/main/src/index.ts)",
    );
    expect(storage).toContain(
      "[the tests](https://github.com/xantiagoma/xtandard-demo/tree/main/test)",
    );
    expect(storage).toContain(
      "![diagram](https://raw.githubusercontent.com/xantiagoma/xtandard-demo/main/docs/assets/d.png)",
    );
    expect(storage).toContain(
      "[a pending guide](https://github.com/xantiagoma/xtandard-demo/blob/main/docs/FUTURE.md#x)",
    );

    const watch = await read("storage/watch");
    expect(watch).toContain("[drivers](/xtandard-demo/storage/#drivers)");
    expect(watch).toContain("[redis](/xtandard-demo/storage/#redis)");

    const guide = await read("guide");
    expect(guide).toContain("pagefind: false");
    expect(guide).toContain("banner:");

    const home = await readFile(join(root, "site/src/content/docs/index.mdx"), "utf8");
    expect(home).toContain(
      'editUrl: "https://github.com/xantiagoma/xtandard-demo/edit/main/site/content/index.mdx"',
    );
    expect(home).toContain("[Repo](https://github.com/xantiagoma/xtandard-demo)");
    expect(home).toContain("[Docs](/xtandard-demo/why/)");
    expect(home).toContain("https://www.npmjs.com/package/@xtandard/demo");
    expect(existsSync(join(root, "site/public/social.png"))).toBe(true);
  });

  it("links to a pending guide's page once it lands", async () => {
    await write({ "docs/FUTURE.md": "# Future\n\n## X\n" });
    const result = syncSite(defineSiteManifest(options()));
    expect(result.warnings).toEqual([]);
    expect(await read("storage")).toContain("[a pending guide](/xtandard-demo/future/#x)");
  });

  it("fails on broken links, unplaced sections, unknown guides and missing files", async () => {
    await write({
      "docs/GUIDE.md": "# Guide\n\n[gone](./GONE.md) [out](../../x.md) [bad](%E0%A4%A)\n",
      "docs/EXTRA.md": "# Extra\n",
      "docs/internal/NOTES.md": "# Notes\n",
      "docs/STORAGE.md": `${STORAGE}\n## Orphan\n\ntext\n`,
      "site/content/index.mdx": "---\ntitle: Home\n---\n@UNKNOWN@\n",
    });
    await rm(join(root, "docs/assets/social.png"));
    const m = defineSiteManifest(
      options({
        sidebar: sidebar([
          { slug: "missing", src: "docs/MISSING.md" },
          { slug: "dup", src: "README.md", sections: ["Why", "Nope"] },
          { slug: "site-only", site: "nope.md" },
        ]),
        ignoreDocs: (f) => f.startsWith("docs/internal/"),
      }),
    );
    const { errors } = syncSite(m);
    expect(errors).toEqual(
      expect.arrayContaining([
        "docs/GUIDE.md: broken link ./GONE.md (docs/GONE.md does not exist)",
        "docs/GUIDE.md: link ../../x.md leaves the repository",
        "docs/GUIDE.md: malformed link %E0%A4%A",
        'docs/STORAGE.md: "## Orphan" is on no page (add it to a page\'s sections in the manifest)',
        "docs/EXTRA.md is not in the site manifest (add it to the sidebar)",
        "manifest: docs/MISSING.md does not exist",
        'README.md: "## Why" is on two pages',
        'README.md: no "## Nope" section for /dup/',
        "manifest: site/content/nope.md does not exist",
        "site/content/index.mdx: unreplaced @UNKNOWN@",
        "docs/assets/social.png does not exist (the site serves it)",
      ]),
    );
    expect(errors.join("\n")).not.toContain("NOTES.md");
    const lines: string[] = [];
    expect(runSync(m, { log: (l) => lines.push(l), error: (l) => lines.push(l) })).toBe(1);
    expect(lines.at(-1)).toMatch(/sync: \d+ error\(s\)/);
  });

  it("requires an H1 for whole-file pages and intro text on some page", async () => {
    await write({
      "docs/GUIDE.md": "No heading here.\n",
      "docs/STORAGE.md": "# Storage\n\nIntro.\n\n## Drivers\n\nx\n\n## Watch\n\ny\n",
    });
    const m = defineSiteManifest(
      options({
        sidebar: [
          { slug: "guide", src: "docs/GUIDE.md" },
          { slug: "storage", src: "docs/STORAGE.md", sections: ["Drivers", "Watch"] },
        ],
      }),
    );
    expect(syncSite(m).errors).toEqual([
      "docs/STORAGE.md: the text above the first H2 is on no page (set intro on one)",
      "docs/GUIDE.md: no H1 to take the title from",
    ]);
  });

  it("runSync prints the page count on success", () => {
    const lines: string[] = [];
    expect(
      runSync(defineSiteManifest(options()), { log: (l) => lines.push(l), error: () => {} }),
    ).toBe(0);
    expect(lines.at(-1)).toBe("sync: 6 pages in site/src/content/docs (base /xtandard-demo)");
  });
});

describe("Slugger and descriptions", () => {
  it("matches GitHub's anchors", () => {
    const s = new Slugger();
    expect(s.slug("Change notifications (`withWatch`)")).toBe("change-notifications-withwatch");
    expect(s.slug("Redis!")).toBe("redis");
    expect(s.slug("Redis!")).toBe("redis-1");
    expect(s.slug("Redis")).toBe("redis-2");
    expect(s.slug("Über café 2.0")).toBe("über-café-20");
    expect(s.slug("snake_case and-dash")).toBe("snake_case-and-dash");
  });

  it("describes from the first prose paragraph, capped at ~200 characters", () => {
    expect(describeMarkdown(["", "- a list", "", "The **real** text.", "More."])).toBe(
      "The real text. More.",
    );
    expect(describeMarkdown(["```", "code", "```"])).toBeUndefined();
    const long = describeMarkdown([`${"word ".repeat(60)}`])!;
    expect(long.length).toBeLessThanOrEqual(201);
    expect(long.endsWith("…")).toBe(true);
  });
});
