// Navigation: a stack of routes. The bottom is always the Overview; switching screens (number keys, the
// switcher) replaces everything above it, opening a record pushes, Esc pops.
import { createContext, createSignal, useContext } from "solid-js"
import { runWithContext } from "../context"
import type { Kernel } from "../host"
import { notify } from "./messages"
import type { TuiRegistry } from "./registry"
import type { Route } from "./types"

export const OVERVIEW_ID = "overview"

export type Nav = {
  route(): Route
  stack(): Route[]
  // Switches to a top-level screen: the stack becomes Overview (and the screen, unless it is the Overview).
  go(screenId: string, params?: Record<string, string>): void
  // Opens a record in the current screen when its type has tabs; otherwise shows its label in the status bar.
  open(ref: string, tab?: string): Promise<void>
  // Pops the top route; false when already at the Overview.
  back(): boolean
  replaceParams(params: Record<string, string>): void
  // The breadcrumbs after the screen chip: the refs of the open records (`#CRM` shows as `CRM`).
  crumbs(): string[]
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createNav(kernel: Kernel, registry: TuiRegistry, track: <T>(p: Promise<T>) => Promise<T> = (p) => p): Nav {
  const home: Route = { kind: "screen", screen: OVERVIEW_ID }
  const [stack, setStack] = createSignal<Route[]>([home])
  const route = () => stack()[stack().length - 1]!

  const screenRoute = (screen: string, params?: Record<string, string>): Route =>
    params ? { kind: "screen", screen, params } : { kind: "screen", screen }

  return {
    route,
    stack,
    go(screenId, params) {
      setStack(screenId === OVERVIEW_ID ? [screenRoute(OVERVIEW_ID, params)] : [home, screenRoute(screenId, params)])
    },
    open(ref, tab) {
      return track(
        runWithContext(kernel.context(), async () => {
          const found = await kernel.records.resolveAny(ref)
          if (!found) return notify(`no record ${ref}`, "error")
          if (registry.tabsFor(found.type).length > 0) {
            const next: Route = { kind: "record", screen: route().screen, ref, ...(tab !== undefined ? { tab } : {}) }
            setStack((s) => [...s, next])
            return
          }
          notify(`${ref}: ${await kernel.records.label(ref)}`)
        }).catch((e: unknown) => notify(message(e), "error")),
      )
    },
    back() {
      if (stack().length <= 1) return false
      setStack((s) => s.slice(0, -1))
      return true
    },
    replaceParams(params) {
      const top = route()
      if (top.kind !== "screen") return
      setStack((s) => [...s.slice(0, -1), screenRoute(top.screen, params)])
    },
    crumbs() {
      return stack()
        .filter((r): r is Extract<Route, { kind: "record" }> => r.kind === "record")
        .map((r) => (r.ref.startsWith("#") ? r.ref.slice(1) : r.ref))
    },
  }
}

export const NavContext = createContext<Nav>()

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error("useNav() must be called inside <TuiApp>")
  return nav
}
