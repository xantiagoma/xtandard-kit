// @vitest-environment happy-dom
/**
 * Render coverage for the shared components copied as-is (primitives, ui-bits, Toast) and the
 * merged bits (dialogs, drawer, copy button, cards).
 *
 * @module
 */

import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfirmDialog,
  CopyButton,
  Drawer,
  EmptyCard,
  LoadingRow,
  Mono,
  Page,
  PageHeader,
  SectionCard,
  StatCard,
} from "../src/ui/components/bits.tsx";
import {
  CreatableCombobox,
  Dropdown,
  Segmented,
  TextArea,
  TextInput,
  ToggleSwitch,
} from "../src/ui/components/primitives.tsx";
import { ToastProvider, useToast } from "../src/ui/components/Toast.tsx";
import { Avatar, Badge, Button, Kbd } from "../src/ui/components/ui-bits.tsx";
import { cn } from "../src/ui/lib/utils.ts";
import { portalContainerRef, setPortalContainerRef } from "../src/ui/lib/portal-container.ts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ui-bits and primitives", () => {
  it("cn merges Tailwind classes", () => {
    expect(cn("px-2", false, "px-4", ["text-sm"])).toBe("px-4 text-sm");
  });

  it("renders buttons, badges, avatars and kbd", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" icon={<b>i</b>} onClick={onClick}>
          Save
        </Button>
        <Button loading>Busy</Button>
        <Badge>new</Badge>
        <Avatar initials="AL" />
        <Kbd>⌘K</Kbd>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: /Busy/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("renders the form primitives", () => {
    const onChecked = vi.fn();
    const onSeg = vi.fn();
    render(
      <>
        <ToggleSwitch checked={false} onCheckedChange={onChecked} aria-label="on" />
        <Segmented
          value="a"
          onValueChange={onSeg}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
        />
        <Dropdown
          value="x"
          onValueChange={() => {}}
          options={[{ value: "x", label: "Ex", description: "d" }]}
        />
        <CreatableCombobox value="" options={["one"]} onSelect={() => {}} onCreate={() => {}} />
        <TextInput placeholder="name" />
        <TextArea placeholder="body" />
      </>,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChecked).toHaveBeenCalled();
    fireEvent.click(screen.getByText("B"));
    expect(onSeg).toHaveBeenCalled();
    expect(screen.getByPlaceholderText("name")).toBeTruthy();
    expect(screen.getByPlaceholderText("body")).toBeTruthy();
  });

  it("portal container ref is settable and resettable", () => {
    const ref = { current: null };
    setPortalContainerRef(ref);
    expect(portalContainerRef()).toBe(ref);
    setPortalContainerRef(undefined);
    expect(portalContainerRef()).toBeUndefined();
  });
});

describe("Toast", () => {
  it("adds and dismisses toasts; useToast needs the provider", () => {
    function Add() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.add("success", "Saved", "detail")}>
          add
        </button>
      );
    }
    render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByRole("alert").textContent).toContain("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Add />)).toThrow(/within ToastProvider/);
  });
});

describe("bits", () => {
  it("renders layout bits", () => {
    render(
      <Page wide>
        <PageHeader title="Events" description="All of them" actions={<b>act</b>} />
        <SectionCard title="Card" description="desc" actions={<i>x</i>}>
          body
        </SectionCard>
        <StatCard label="Total" value="12" hint="last 24h" tone="text-success" icon={<i>ic</i>} />
        <EmptyCard icon={<i>e</i>} action={<b>new</b>}>
          Nothing yet
        </EmptyCard>
        <LoadingRow label="Loading…" />
        <Mono>whk_1</Mono>
      </Page>,
    );
    for (const text of ["Events", "All of them", "Card", "12", "Nothing yet", "Loading…", "whk_1"])
      expect(screen.getByText(text)).toBeTruthy();
  });

  it("ConfirmDialog confirms and cancels", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete?"
        confirmLabel="Delete"
        danger
      >
        Gone for good.
      </ConfirmDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("Drawer renders title, actions, footer and closes", () => {
    const onClose = vi.fn();
    render(
      <Drawer
        open
        onClose={onClose}
        title="evt_1"
        description="sub"
        actions={<b>act</b>}
        footer={<i>foot</i>}
      >
        details
      </Drawer>,
    );
    expect(screen.getByText("details")).toBeTruthy();
    expect(screen.getByText("foot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("CopyButton copies, toasts, and reports a denied clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <ToastProvider>
        <CopyButton text="whsec_1" label="Copy secret" toastMessage="Copied" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy secret" }));
    });
    expect(writeText).toHaveBeenCalledWith("whsec_1");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Copied"));
    cleanup();
    vi.stubGlobal("navigator", {});
    render(
      <ToastProvider>
        <CopyButton text="x" />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not copy to the clipboard"),
    );
  });
});
