// Navigation: a stack of routes. The bottom is always the Attention screen (id "overview"); switching screens
// (number keys, the switcher) replaces everything above it, opening a record pushes, Esc pops. A record route
// carries the screen its type belongs to (ScreenDef.records), else the screen it was opened from: the header chip
// names it.
import { createContext, createEffect, createSignal, onCleanup, useContext } from "solid-js"
import { runWithContext } from "../context"
import type { Kernel } from "../host"
import { notify } from "./messages"
import type { TuiRegistry } from "./registry"
import type { Route } from "./types"

export const OVERVIEW_ID = "overview"

export type Nav = {
  route(): Route
  stack(): Route[]
  // Switches to a top-level screen: the stack becomes Attention (and the screen, unless it is Attention).
  go(screenId: string, params?: Record<string, string>): void
  // Opens a record: in its type's screen (or the current one) when its type has tabs, else in its type's first form
  // (through the form opener the app installs: useOverlay().openForm), else shows `<ref>: <label>` in the status bar.
  open(ref: string, tab?: string): Promise<void>
  // <TuiApp> installs useOverlay().openForm here; without an opener nav.open never opens a form.
  setFormOpener(open: FormOpener | undefined): void
  // Pops the top route; false when already at Attention.
  back(): boolean
  replaceParams(params: Record<string, string>): void
  // The ref of the record shown now (the top route), for the header's breadcrumb; undefined on a screen. Only the
  // current record shows, however many records were opened on the way.
  crumb(): string | undefined
  // The text a screen shows after the chip while no record is open (`3 People ▾ › All`): set it with useScreenCrumb.
  screenCrumb(): string | undefined
  // Sets the screen crumb for `owner`; undefined clears it, but only if `owner` set it last.
  setScreenCrumb(owner: object, text: string | undefined): void
}

// Opens `recordType`'s form `formId` (undefined: its first) with `props`.
export type FormOpener = (recordType: string, formId: string | undefined, props: { recordRef: string }) => void

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createNav(kernel: Kernel, registry: TuiRegistry, track: <T>(p: Promise<T>) => Promise<T> = (p) => p): Nav {
  const home: Route = { kind: "screen", screen: OVERVIEW_ID }
  const [stack, setStack] = createSignal<Route[]>([home])
  const route = () => stack()[stack().length - 1]!

  let formOpener: FormOpener | undefined
  const [screenCrumb, setCrumb] = createSignal<{ owner: object; text: string } | undefined>(undefined)

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
            const screen = registry.screenForRecord(found.type)?.id ?? route().screen
            const next: Route = { kind: "record", screen, ref, ...(tab !== undefined ? { tab } : {}) }
            setStack((s) => [...s, next])
            return
          }
          const form = registry.forms(found.type)[0]
          if (form && formOpener) return formOpener(found.type, form.id, { recordRef: ref })
          notify(`${ref}: ${await kernel.records.label(ref)}`)
        }).catch((e: unknown) => notify(message(e), "error")),
      )
    },
    setFormOpener(open) {
      formOpener = open
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
    crumb() {
      const top = route()
      return top.kind === "record" ? top.ref : undefined
    },
    screenCrumb: () => (route().kind === "screen" ? screenCrumb()?.text : undefined),
    setScreenCrumb(owner, text) {
      if (text !== undefined) setCrumb({ owner, text })
      else if (screenCrumb()?.owner === owner) setCrumb(undefined)
    },
  }
}

export const NavContext = createContext<Nav>()

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error("useNav() must be called inside <TuiApp>")
  return nav
}

// A screen's crumb in the header after the chip (`› All`, the screen's active tab): follows `text` while the
// calling component is mounted, gone once it unmounts. Undefined shows none.
export function useScreenCrumb(text: () => string | undefined): void {
  const nav = useNav()
  const owner = {}
  createEffect(() => nav.setScreenCrumb(owner, text()))
  onCleanup(() => nav.setScreenCrumb(owner, undefined))
}
