/**
 * A tiny product App on the kit shell, shared by the SPA page (bootSpa) and the embed page
 * (createEmbed): `/config` from the e2e server, two tabs, a dialog, and the current location
 * printed so the tests can read the router state.
 */
import * as React from "react";
import { Router, Route, Switch, useLocation, useSearch } from "wouter";
import {
  Button,
  ConfigError,
  createApiClient,
  ModalDialog,
  Page,
  PageHeader,
  readConfigGlobal,
  ShellFrame,
  useShellConfig,
  useShellNav,
  type ShellAppProps,
  type ShellConfigBase,
} from "../../src/entry-ui.ts";

export const api = createApiClient();
export const CONFIG_GLOBAL = "__KIT_E2E_CONFIG__";

function Where() {
  const [location] = useLocation();
  const search = useSearch();
  return <p data-testid="where">{`${location}${search ? `?${search}` : ""}`}</p>;
}

function Overview() {
  const [open, setOpen] = React.useState(false);
  const go = useShellNav({ stickyParams: ["tenant"] });
  return (
    <Page>
      <PageHeader title="Overview" description="The kit e2e app" />
      <Where />
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Button onClick={() => go("/", { tenant: "acme" })}>Use tenant acme</Button>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="A dialog">
        <p>Portaled into the embed wrapper.</p>
      </ModalDialog>
    </Page>
  );
}

function Events() {
  return (
    <Page>
      <PageHeader title="Events" />
      <Where />
    </Page>
  );
}

function Shell({ forcePortal, logoUrl }: { forcePortal?: boolean; logoUrl?: string }) {
  const shell = useShellConfig<ShellConfigBase>({
    getConfig: () => api.req("config"),
    bootstrap: readConfigGlobal(CONFIG_GLOBAL),
    token: api.getApiToken(),
    forcePortal,
  });
  const go = useShellNav({ stickyParams: ["tenant"] });
  return (
    <ShellFrame
      title={shell.config.title ?? "Kit"}
      logoUrl={logoUrl}
      readonly={shell.readonly}
      portal={shell.portal}
      onBrandClick={() => go("/")}
      tabs={[
        { path: "/", label: "Overview" },
        { path: "/events", label: "Events" },
      ]}
      onNavigate={go}
      fallback={shell.failed ? <ConfigError /> : null}
    >
      {shell.ready ? (
        <Switch>
          <Route path="/events">
            <Events />
          </Route>
          <Route>
            <Overview />
          </Route>
        </Switch>
      ) : null}
    </ShellFrame>
  );
}

export function App({ locationHook, searchHook, base, forcePortal, logoUrl }: ShellAppProps) {
  return (
    <Router hook={locationHook} searchHook={searchHook} base={base}>
      <Shell forcePortal={forcePortal} logoUrl={logoUrl} />
    </Router>
  );
}
