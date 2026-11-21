import * as React from "react";
import { createRoot } from "react-dom/client";
import { createEmbed, type EmbedTheme } from "../../src/entry-ui-embed.ts";
import { api, App } from "./app.tsx";
import "./embed.css";

const { Dashboard } = createEmbed({
  App,
  scopeClass: "xtandard-kit-e2e",
  api,
  themeKey: "xtandard-kit-e2e:theme",
});

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") ?? "inherit") as EmbedTheme;
document.documentElement.className = params.get("htmlClass") ?? "";

createRoot(document.getElementById("root")!).render(
  <div>
    <header id="host-header">
      <h2>Host app</h2>
      <button type="button" id="host-button">
        Host button
      </button>
    </header>
    <Dashboard
      apiBaseUrl={location.origin}
      theme={theme}
      routing="memory"
      className="block h-[600px]"
    />
  </div>,
);
