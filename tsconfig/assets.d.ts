// Asset imports resolved by Vite in the SPA and embed builds (shipped as
// `@xtandard/kit/tsconfig/assets.d.ts`, included by `base.json` and `react.json`).

/** `?raw`: the file's text, inlined (e.g. an SVG mark for `BrandMark`). */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** The URL of the emitted file, or an inlined data URI for small assets. */
declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.css";
