/**
 * The e2e server: serves the built test host and a `/config` endpoint (portal when the request
 * carries a bearer token). Unknown paths fall back to the SPA, like a panel's catch-all.
 */
const root = new URL("../node_modules/.cache/kit-e2e-host/", import.meta.url);
const port = Number(process.env.PORT ?? 3511);

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/healthcheck") return new Response("ok");
    if (pathname === "/config") {
      const portal = (req.headers.get("authorization") ?? "").startsWith("Bearer ");
      return Response.json({ title: "Kit E2E", portal, readonly: portal });
    }
    const file = Bun.file(new URL(`.${pathname}`, root));
    if (pathname !== "/" && (await file.exists())) return new Response(file);
    return new Response(Bun.file(new URL("spa.html", root)), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log(`e2e server on http://localhost:${port}`);
