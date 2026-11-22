/** Release workflows and their documented templates publish a local tarball, not a GitHub repo. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const files = [
  ...readdirSync(join(root, ".github/workflows")).map((f) => join(".github/workflows", f)),
  ...readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("docs", f)),
];

describe("npm publish arguments", () => {
  test.each(files)("%s passes tarball paths as ./relative or absolute", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    // npm reads `owner/name` (no leading `./` or `/`) as a GitHub shorthand and runs git ls-remote.
    const bare = [...text.matchAll(/npm publish\s+"?([^\s"`]+)/g)]
      .map((m) => m[1]!)
      .filter((arg) => !arg.startsWith("-") && arg.includes("/"))
      .filter((arg) => !/^(\.\.?\/|\/|\$)/.test(arg));
    expect(bare).toEqual([]);
  });
});
