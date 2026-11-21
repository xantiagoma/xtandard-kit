/**
 * `@xtandard/kit/ui` — the shared admin shell of the xtandard products, as compiled React
 * components and helpers (ADR 0008):
 *
 * - primitives (`ToggleSwitch`, `Segmented`, `Dropdown`, `CreatableCombobox`, `TextInput`,
 *   `TextArea`), `Button`/`Badge`/`Avatar`/`Kbd`, toasts and the theme toggle;
 * - the theme store (`createThemeStore`, keyed per product), host-theme detection and
 *   `ThemeProvider`/`useTheme`;
 * - `createApiClient` (the panel API client core) and `takeTokenFromUrl`;
 * - `bootSpa` (the SPA's `main.tsx`), `ShellFrame` + `useShellConfig` + `useShellNav`;
 * - the common bits (`Spinner`, `PageHeader`, `ModalDialog`, `Drawer`, `CopyButton`, …), the
 *   format helpers and `BrandMark`.
 *
 * Pair it with `@xtandard/kit/ui/styles.css`. Product seams (theme key, config global, scope
 * class, error class, brand tokens) are parameters.
 *
 * Optional peers: `react`, `react-dom`, `@base-ui-components/react`, `lucide-react`, `wouter`,
 * `@tanstack/react-query`, `clsx`, `tailwind-merge`.
 *
 * @module ui
 */

export {
  createThemeStore,
  detectHostTheme,
  resolveTheme,
  subscribeHostTheme,
  subscribeSystemTheme,
  systemTheme,
  type ResolvedTheme,
  type ThemePref,
  type ThemeSignalSource,
  type ThemeStore,
} from "./ui/theme.ts";
export {
  ThemeProvider,
  useResolvedTheme,
  useTheme,
  type ThemeMode,
  type ThemeProviderProps,
  type ThemeState,
} from "./ui/theme-context.tsx";
export {
  ApiError,
  createApiClient,
  toQuery,
  type ApiClient,
  type ApiClientOptions,
  type ApiErrorBody,
  type ApiErrorConstructor,
  type CreateApiClientOptions,
  type FetchLike,
  type QueryValue,
} from "./ui/api-client.ts";
export { takeTokenFromUrl } from "./ui/token.ts";
export {
  bootSpa,
  createShellQueryClient,
  type BootedSpa,
  type BootSpaOptions,
  type ShellAppProps,
} from "./ui/boot.tsx";
export {
  ConfigError,
  readConfigGlobal,
  ShellFrame,
  useShellConfig,
  useShellNav,
  type ShellConfigBase,
  type ShellConfigState,
  type ShellFrameProps,
  type ShellTab,
  type UseShellConfigOptions,
  type UseShellNavOptions,
} from "./ui/shell.tsx";
export {
  formatCompact,
  formatCount,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  initials,
  relativeTime,
  truncate,
  type FormatDateTimeOptions,
} from "./ui/format.ts";
export { cn } from "./ui/lib/utils.ts";
export { canLeave, clearNavBlocker, setNavBlocker } from "./ui/lib/nav-guard.ts";
export { portalContainerRef, setPortalContainerRef } from "./ui/lib/portal-container.ts";
export {
  CreatableCombobox,
  Dropdown,
  Segmented,
  TextArea,
  TextInput,
  ToggleSwitch,
} from "./ui/components/primitives.tsx";
export { Avatar, Badge, Button, Kbd, type ButtonProps } from "./ui/components/ui-bits.tsx";
export { ToastProvider, useToast, type Toast, type ToastKind } from "./ui/components/Toast.tsx";
export { ThemeToggle, type ThemeToggleProps } from "./ui/components/ThemeToggle.tsx";
export { BrandMark, svgDataUrl, type BrandMarkProps } from "./ui/components/BrandMark.tsx";
export {
  ConfirmDialog,
  CopyButton,
  Drawer,
  EmptyCard,
  LoadingRow,
  ModalDialog,
  Mono,
  Page,
  PageHeader,
  SectionCard,
  Spinner,
  StatCard,
} from "./ui/components/bits.tsx";
