/**
 * The TypeDoc plugin for the API reference (passed to starlight-typedoc by `defineXtandardSite`):
 *
 * 1. A function whose return type is annotated with one of the package's own type aliases is
 *    documented with that alias (`webhooksElysia(options): WebhooksElysiaPlugin`), as written.
 *    TypeDoc otherwise prints the type the checker resolves the alias to — for the Elysia adapters,
 *    the plugin's full inferred `Elysia<…, object & object & …>` generics.
 * 2. Each entry point's module is named after its subpath (`storage/redis`, the root module name
 *    for `src/index.ts`), whatever its `@module` comment says, so the API routes match `exports`.
 * 3. A symbol several entry points export is documented once (see `apiOwners`); the others get a
 *    reference. Those are recorded in `<site>/.astro/api-reexports.json` so `apiOverviews` can list
 *    them on each re-exporting module's page.
 *
 * `typedoc` and `typescript` are loaded from the site's own install when the plugin runs (the
 * compiler instance that parsed the program).
 *
 * @module
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Application, DeclarationReflection, ReferenceReflection } from "typedoc";
import { importFromSite } from "./resolve.ts";

/**
 * A re-export: `name` in module `module` is documented in `owner` as the `kind` member `target`
 * (a different name for a renamed or `default` export).
 */
export interface Reexport {
  module: string;
  name: string;
  owner: string;
  kind: string;
  target: string;
}

/** Where the plugin writes, and `apiOverviews` reads, the re-exports of a site. */
export function reexportsFile(siteDir: string): string {
  return join(siteDir, ".astro/api-reexports.json");
}

/** Read the re-exports the plugin recorded for a site (`[]` before the first API build). */
export function readReexports(siteDir: string): Reexport[] {
  const file = reexportsFile(siteDir);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Reexport[]) : [];
}

/** Options for {@link createTypedocPlugin}. */
export interface TypedocPluginOptions {
  /** Module name per entry file (absolute path → `storage/redis`); see `manifest.apiEntries()`. */
  moduleNames?: Record<string, string>;
}

/**
 * Create the TypeDoc plugin for the site at `siteDir`. Pass the returned function in TypeDoc's
 * `plugin` option (TypeDoc 0.26+ accepts plugin functions and awaits them).
 */
export function createTypedocPlugin(
  siteDir: string,
  options: TypedocPluginOptions = {},
): (app: Application) => Promise<void> {
  const moduleNames = new Map(
    Object.entries(options.moduleNames ?? {}).map(([file, name]) => [resolve(file), name]),
  );
  return async function load(app: Application): Promise<void> {
    // The site's typedoc and typescript: the program's nodes come from that compiler instance.
    const [typedoc, tsModule] = await Promise.all([
      importFromSite<typeof import("typedoc")>("typedoc", siteDir),
      importFromSite<typeof import("typescript") & { default?: typeof import("typescript") }>(
        "typescript",
        siteDir,
      ),
    ]);
    const ts = tsModule.default ?? tsModule;
    const { Converter, ReflectionKind } = typedoc;

    /** The generated folder for each member kind (typedoc-plugin-markdown's defaults). */
    const kindDirs: [number, string][] = [
      [ReflectionKind.Function, "functions"],
      [ReflectionKind.Class, "classes"],
      [ReflectionKind.Interface, "interfaces"],
      [ReflectionKind.TypeAlias, "type-aliases"],
      [ReflectionKind.Variable, "variables"],
      [ReflectionKind.Enum, "enumerations"],
      [ReflectionKind.Namespace, "namespaces"],
    ];

    app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, signature, node) => {
      const typeNode = node && "type" in node ? node.type : undefined;
      if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return;
      let symbol = context.checker.getSymbolAtLocation(typeNode.typeName);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = context.checker.getAliasedSymbol(symbol);
      const declaration = symbol?.declarations?.[0];
      if (
        !declaration ||
        !ts.isTypeAliasDeclaration(declaration) ||
        declaration.getSourceFile().fileName.includes("/node_modules/")
      )
        return;
      signature.type = context.converter.convertType(context, typeNode);
    });

    // After TypeDoc applied `@module` names: a bare `@module` would leave the file name
    // (`entry-storage-redis`), which matches no route.
    app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
      if (moduleNames.size === 0) return;
      for (const module of context.project.getReflectionsByKind(ReflectionKind.Module)) {
        const symbol = context.getSymbolFromReflection(module);
        const file = symbol?.declarations
          ?.find((d) => ts.isSourceFile(d))
          ?.getSourceFile().fileName;
        const name = file && moduleNames.get(resolve(file));
        if (name) module.name = name;
      }
    });

    app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
      const reexports: Reexport[] = [];
      for (const ref of context.project.getReflectionsByKind(ReflectionKind.Reference)) {
        const module = ref.parent;
        const target = (ref as ReferenceReflection).tryGetTargetReflectionDeep() as
          | DeclarationReflection
          | undefined;
        const owner = target?.parent;
        const kind = target && kindDirs.find(([k]) => target.kindOf(k))?.[1];
        if (
          !module?.kindOf(ReflectionKind.Module) ||
          !owner?.kindOf(ReflectionKind.Module) ||
          !kind
        )
          continue;
        reexports.push({
          module: module.name,
          name: ref.name,
          owner: owner.name,
          kind,
          target: target.name,
        });
      }
      const file = reexportsFile(siteDir);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(reexports, null, 2));
    });
  };
}
