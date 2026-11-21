/**
 * The `xtandard-kit` command: build-time helpers for the xtandard products
 * (`scope-embed-css`, `fix-elysia2-types`, `api-surface`, …).
 *
 * @module
 */

const HELP = `xtandard-kit <command> [options]

Commands:
  help    Show this help.
`;

/** Run the CLI with `argv` (without the node/bin prefix); resolves to the exit code. */
export async function run(argv: string[]): Promise<number> {
  const [command] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
  return 1;
}
