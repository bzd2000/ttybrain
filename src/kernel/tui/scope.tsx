// The app-wide services (useApp) and <PluginScope>, in their own module so the kernel's components (Overview,
// RecordView, the header badges) can use them without importing app.tsx.
import { createContext, useContext, type Accessor, type JSX } from "solid-js"
import type { Kernel } from "../host"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { RuntimeProvider } from "./data"
import type { TuiRegistry } from "./registry"

// The app-wide services components reach through useApp().
export type TuiAppContext = {
  kernel: Kernel
  registry: TuiRegistry
  // Registers a load with the app, so tests can wait for it (renderTui's settle()).
  track<T>(p: Promise<T>): Promise<T>
  // The live-refresh version (refresh.ts): bumps when the data changed.
  version: Accessor<number>
}

export const AppContext = createContext<TuiAppContext>()

export function useApp(): TuiAppContext {
  const app = useContext(AppContext)
  if (!app) throw new Error("useApp() must be called inside <TuiApp>")
  return app
}

// Every registered component (screen, tab, panel, badge, overlay) renders inside one: an error boundary labelled
// with its title, and its plugin's runtime for useRuntime() (none for the kernel's Overview). Overlays pass
// `close`, so Esc still closes one that failed.
export function PluginScope(props: { kernel: Kernel; plugin: string | undefined; label: string; close?: () => void; children: JSX.Element }) {
  return (
    <ErrorBoundary label={props.label} close={props.close}>
      <RuntimeProvider runtime={props.plugin === undefined ? undefined : props.kernel.runtime(props.plugin)}>{props.children}</RuntimeProvider>
    </ErrorBoundary>
  )
}
