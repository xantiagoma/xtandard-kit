/**
 * Optional-peer helpers shared by every subpath that needs a driver, framework or tool package.
 *
 * @module
 */

/**
 * Throw a clear, actionable error for a missing optional peer. The message names the package to
 * install (what the user needs) and the kit subpath that asked for it.
 */
export function requirePeer(name: string, subpath: string): never {
  throw new Error(
    `${subpath} requires the optional peer "${name}". Install it with: bun add ${name} (or npm install ${name})`,
  );
}

/**
 * `import(name)` an optional peer, turning a module-not-found error into {@link requirePeer}'s
 * message. Other errors (a broken install, a throwing module) propagate unchanged.
 */
export async function importPeer<T>(
  name: string,
  subpath: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isModuleNotFound(error, name)) requirePeer(name, subpath);
    throw error;
  }
}

function isModuleNotFound(error: unknown, name: string): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  return (
    typeof message === "string" &&
    /cannot find (module|package)/i.test(message) &&
    message.includes(name)
  );
}
