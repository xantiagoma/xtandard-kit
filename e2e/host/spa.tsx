import { bootSpa } from "../../src/entry-ui.ts";
import { api, App, CONFIG_GLOBAL } from "./app.tsx";
import "./spa.css";

bootSpa({
  App,
  configGlobal: CONFIG_GLOBAL,
  themeKey: "xtandard-kit-e2e:theme",
  tokenFromUrl: true,
  api,
});
