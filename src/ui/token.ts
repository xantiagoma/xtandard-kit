/**
 * Portal-token hand-off for the standalone SPA: a host links its customer to
 * `https://app.example.com/panel/#token=…` (the fragment never reaches servers or access logs);
 * `?token=` works too. The token is removed from the address bar so it isn't bookmarked, shared or
 * sent in a `Referer` header.
 *
 * @module
 */

/**
 * Read a portal token from `#token=` (preferred) or `?token=`, and strip it from the URL through
 * `replace` (e.g. `(url) => history.replaceState(null, "", url)`). Other query and hash parameters
 * are kept. Returns the token, or `null` when the URL carries none (nothing is replaced then).
 */
export function takeTokenFromUrl(
  location: Pick<Location, "hash" | "search" | "pathname">,
  replace: (url: string) => void,
): string | null {
  const rawHash = location.hash.replace(/^#/, "");
  // A hash route (`#/events`) is not a parameter list: leave it alone.
  const hash = rawHash.startsWith("/") ? undefined : new URLSearchParams(rawHash);
  const search = new URLSearchParams(location.search);
  const fromHash = hash?.get("token");
  const token = fromHash || search.get("token");
  if (!token) return null;
  // Only re-serialise the parts that carried a token, so the rest stays byte-identical.
  let s = location.search.replace(/^\?/, "");
  if (search.has("token")) {
    search.delete("token");
    s = search.toString();
  }
  let h = rawHash;
  if (hash?.has("token")) {
    hash.delete("token");
    h = hash.toString();
  }
  replace(`${location.pathname}${s ? `?${s}` : ""}${h ? `#${h}` : ""}`);
  return token;
}
