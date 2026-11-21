/**
 * `@xtandard/kit/cli` — building blocks for the products' CLIs: `env` (empty
 * counts as unset), `parseArgs`, `buildAuthFromEnv` and `storageFromEnv` (both
 * reject unknown modes/drivers), `describeStorage`, `startServer` (Bun or the
 * Node bridge), `serve`, `pkgVersion` and the `isMainModule` self-run guard.
 *
 * @module
 */

export {
  buildAuthFromEnv,
  defaultStorageRegistry,
  describeStorage,
  driverEnvOf,
  env,
  isMainModule,
  isTruthy,
  parseArgs,
  pkgVersion,
  resolveStorageConfig,
  serve,
  startServer,
  storageFromEnv,
  type AuthFromEnv,
  type AuthFromEnvOptions,
  type Env,
  type ParseArgsOptions,
  type ParsedArgs,
  type RunningServer,
  type ServeOptions,
  type ServeSettings,
  type StartServerOptions,
  type StorageConfig,
  type StorageFactory,
  type StorageFromEnvOptions,
  type StorageRegistry,
  type StorageRole,
  type StorageRoleDefaults,
} from "./cli/index.ts";
