/**
 * Post-`vp pack` step: copies the UI stylesheet into `dist/ui/styles.css`
 * (exported as `@xtandard/kit/ui/styles.css`).
 *
 * @module
 */
const root = new URL("../", import.meta.url);
await Bun.write(new URL("dist/ui/styles.css", root), Bun.file(new URL("src/ui/styles.css", root)));
