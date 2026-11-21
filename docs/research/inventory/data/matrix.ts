// Usage: bun matrix.ts <outfile>
// For each file path present in >=2 product repos: LOC per repo, normalized-diff lines between webhooks and each other repo.
import { $ } from "bun";
const ROOT = "/Users/santi/Projects";
const repos = ["webhooks", "flags", "audit", "links", "entitlements"] as const;
const words: Record<string, string[]> = {
  webhooks: ["webhooks", "webhook"],
  flags: ["flags", "flag"],
  audit: ["audit", "audits"],
  links: ["links", "link"],
  entitlements: ["entitlements", "entitlement"],
};
function norm(repo: string, s: string) {
  for (const w of words[repo]) {
    const cap = w[0].toUpperCase() + w.slice(1);
    const up = w.toUpperCase();
    s = s.replaceAll(up, "XPROD").replaceAll(cap, "Xprod").replaceAll(w, "xprod");
  }
  return s;
}
const lists: Record<string, Set<string>> = {};
for (const r of repos) {
  const out = await $`git -C ${ROOT}/xtandard-${r} ls-files`.text();
  lists[r] = new Set(out.split("\n").filter((f) => f && !f.startsWith("site/src/content/docs/api/") && !/\.(png|ico|svg|lock|jpg|webp)$/.test(f) && !f.startsWith("docs/research")));
}
const all = new Set<string>();
for (const r of repos) for (const f of lists[r]) all.add(f);
const tmp = "/private/tmp/claude-501/-Users-santi-Projects-xtandard-kit/0d4aefb3-5fe9-40cf-831c-2a555ad51e5b/scratchpad/n";
await $`mkdir -p ${tmp}`;
const rows: string[] = [];
rows.push(["file", "n", ...repos.map((r) => `loc:${r}`), ...repos.slice(1).map((r) => `d:wh-${r}`), "rawIdentical"].join("\t"));
for (const f of [...all].sort()) {
  const present = repos.filter((r) => lists[r].has(f));
  if (present.length < 2) continue;
  const texts: Record<string, string> = {};
  const raw: Record<string, string> = {};
  for (const r of present) {
    raw[r] = await Bun.file(`${ROOT}/xtandard-${r}/${f}`).text();
    texts[r] = norm(r, raw[r]);
  }
  const base = present.includes("webhooks") ? "webhooks" : present[0];
  await Bun.write(`${tmp}/a`, texts[base]);
  const ds: string[] = [];
  for (const r of repos.slice(1)) {
    if (!texts[r] || r === base) { ds.push(r === base ? "base" : "-"); continue; }
    await Bun.write(`${tmp}/b`, texts[r]);
    const d = await $`diff ${tmp}/a ${tmp}/b`.nothrow().text();
    ds.push(String(d.split("\n").filter((l) => l.startsWith("<") || l.startsWith(">")).length));
  }
  const rawSame = present.every((r) => raw[r] === raw[present[0]]);
  rows.push([f, present.length, ...repos.map((r) => (raw[r] ? raw[r].split("\n").length : "-")), ...ds, rawSame ? "Y" : ""].join("\t"));
}
await Bun.write(process.argv[2], rows.join("\n") + "\n");
