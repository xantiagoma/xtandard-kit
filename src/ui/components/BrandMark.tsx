import * as React from "react";
import { useTheme } from "../theme-context.tsx";
import { cn } from "../lib/utils.ts";

/** An SVG document as a `data:` URL, so the SPA and the embed render it without serving an asset. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Props for {@link BrandMark}. */
export interface BrandMarkProps {
  /** The mark for light surfaces: SVG markup (e.g. a Vite `?raw` import) or a URL. */
  light: string;
  /** The mark for dark surfaces; defaults to `light`. */
  dark?: string;
  className?: string;
  /** Alt text; empty (decorative) by default, since the title usually sits next to it. */
  alt?: string;
}

const toSrc = (mark: string) => (mark.trimStart().startsWith("<") ? svgDataUrl(mark) : mark);

/**
 * A product's symbol, inlined as a data URL (pass the SVG markup) so it works inside the embed with
 * no asset to serve. Inside a `ThemeProvider` it renders the variant for the resolved theme; outside
 * one it renders both and lets the `dark:` variant pick.
 */
export function BrandMark({
  light,
  dark,
  className,
  alt = "",
}: BrandMarkProps): React.ReactElement {
  const { store, resolved } = useTheme();
  const lightSrc = React.useMemo(() => toSrc(light), [light]);
  const darkSrc = React.useMemo(() => (dark ? toSrc(dark) : lightSrc), [dark, lightSrc]);
  const hidden = alt ? undefined : true;
  if (store) {
    return (
      <img
        src={resolved === "dark" ? darkSrc : lightSrc}
        alt={alt}
        aria-hidden={hidden}
        className={cn("shrink-0", className)}
      />
    );
  }
  return (
    <>
      <img
        src={lightSrc}
        alt={alt}
        aria-hidden={hidden}
        className={cn("shrink-0 dark:hidden", className)}
      />
      <img
        src={darkSrc}
        alt=""
        aria-hidden
        className={cn("hidden shrink-0 dark:block", className)}
      />
    </>
  );
}
