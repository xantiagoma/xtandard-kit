/**
 * `takeTokenFromUrl` (en's fix for wh/au/li): the portal token is read from `#token=` or `?token=`
 * and stripped from the address bar, so it isn't bookmarked, shared or leaked via `Referer`.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { takeTokenFromUrl } from "../src/ui/token.ts";

function take(location: { pathname: string; search: string; hash: string }) {
  let replaced: string | undefined;
  const token = takeTokenFromUrl(location, (u) => (replaced = u));
  return { token, replaced };
}

describe("takeTokenFromUrl", () => {
  it("takes a hash token and strips it, keeping other params", () => {
    expect(
      take({ pathname: "/billing/", search: "?x=1", hash: "#token=entpt_abc&tab=usage" }),
    ).toEqual({ token: "entpt_abc", replaced: "/billing/?x=1#tab=usage" });
  });

  it("takes a query token and strips it (the wh/au/li form)", () => {
    expect(take({ pathname: "/webhooks/", search: "?token=whpt_1&app=a", hash: "" })).toEqual({
      token: "whpt_1",
      replaced: "/webhooks/?app=a",
    });
    expect(take({ pathname: "/", search: "?token=t1", hash: "" })).toEqual({
      token: "t1",
      replaced: "/",
    });
  });

  it("prefers the hash token and strips both", () => {
    expect(take({ pathname: "/", search: "?token=q", hash: "#token=h" })).toEqual({
      token: "h",
      replaced: "/",
    });
  });

  it("leaves a hash route alone", () => {
    expect(take({ pathname: "/", search: "?token=q", hash: "#/events?x=1" })).toEqual({
      token: "q",
      replaced: "/#/events?x=1",
    });
  });

  it("keeps untouched parts byte-identical", () => {
    expect(take({ pathname: "/", search: "?a=%20b&c", hash: "#token=t" })).toEqual({
      token: "t",
      replaced: "/?a=%20b&c",
    });
  });

  it("returns null and does not touch the URL without a token", () => {
    expect(take({ pathname: "/", search: "", hash: "#x" })).toEqual({
      token: null,
      replaced: undefined,
    });
    expect(take({ pathname: "/", search: "?token=", hash: "" }).token).toBeNull();
  });
});
