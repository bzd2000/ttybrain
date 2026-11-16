// <TuiApp>: the frame (header, main area, status bar), the router that renders the current screen, the overlay
// stack (switcher, help, global actions) and the global key dispatch. Everything inside comes from the registry.
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createContext, createSignal, For, onCleanup, Show, useContext, type Component, type JSX } from "solid-js"
import { runWithContext } from "../context"
import type { Kernel } from "../host"
import { Help } from "./components/Help"
import { OverviewScreen } from "./components/OverviewScreen"
import { Switcher, type SwitcherEntry } from "./components/Switcher"
import { longDate } from "./format"
import { Header, StatusBar } from "./frame"
import { createGlobalKeyHandler, FRAME_HINTS, KeysContext, KeysStore, LayerContext, SCREEN_LAYER, useGlobalKeys } from "./keys"
import { clearMessages, currentMessage } from "./messages"
import { createNav, NavContext, OVERVIEW_ID, type Nav } from "./nav"
import { OVERVIEW_SLOT, type TuiRegistry } from "./registry"
import { theme } from "./theme"

export const MIN_WIDTH = 60
export const MIN_HEIGHT = 15

// What tests (renderTui) and the entry point get from a mounted app.
export type TuiHandle = {
  nav: Nav
  // Resolves once no tracked load (a query, a count) is in flight.
  idle(): Promise<void>
}

// The app-wide services components reach through useApp().
export type TuiAppContext = {
  kernel: Kernel
  registry: TuiRegistry
  // Registers a load with the app, so tests can wait for it (renderTui's settle()).
  track<T>(p: Promise<T>): Promise<T>
}

const AppContext = createContext<TuiAppContext>()

export function useApp(): TuiAppContext {
  const app = useContext(AppContext)
  if (!app) throw new Error("useApp() must be called inside <TuiApp>")
  return app
}

type Overlay = { id: string; kind: string; render: () => JSX.Element }
type Screen = SwitcherEntry & { component: Component<{}> }

export function TuiApp(props: { kernel: Kernel; registry: TuiRegistry; expose?: (handle: TuiHandle) => void }) {
  const { kernel, registry } = props
  const renderer = useRenderer()
  const dims = useTerminalDimensions()

  const inflight = new Set<Promise<unknown>>()
  const track = <T,>(p: Promise<T>): Promise<T> => {
    inflight.add(p)
    const done = () => inflight.delete(p)
    p.then(done, done)
    return p
  }
  const idle = async () => {
    while (inflight.size > 0) await Promise.allSettled([...inflight])
  }

  const nav = createNav(kernel, registry, track)
  const [overlays, setOverlays] = createSignal<Overlay[]>([])
  const keys = new KeysStore(() => overlays().at(-1)?.id ?? SCREEN_LAYER)
  let overlayCount = 0
  const openOverlay = (kind: string, render: (close: () => void) => JSX.Element) => {
    if (overlays().some((o) => o.kind === kind)) return
    const id = `overlay-${++overlayCount}`
    const close = () => setOverlays((list) => list.filter((o) => o.id !== id))
    setOverlays((list) => [...list, { id, kind, render: () => render(close) }])
  }

  const screens: Screen[] = [{ id: OVERVIEW_ID, title: "Overview", slot: OVERVIEW_SLOT, component: OverviewScreen }, ...registry.screens()]
  const screenOf = (id: string) => screens.find((s) => s.id === id)
  const current = () => screenOf(nav.route().screen) ?? screens[0]!
  const route = () => nav.route()
  const tooSmall = () => dims().width < MIN_WIDTH || dims().height < MIN_HEIGHT

  const problems = () => [
    ...registry.errors().map((e) => e.error),
    ...kernel.plugins.filter((p) => p.status === "failed").map((p) => `${p.id}: ${p.error ?? "failed"}`),
  ]
  const hints = () => {
    const own = keys.hints()
    if (keys.top() !== SCREEN_LAYER || keys.textFocused()) return own
    return [...own, ...FRAME_HINTS]
  }

  useGlobalKeys(
    createGlobalKeyHandler({
      keys,
      action(ch) {
        const def = registry.globalActions().find((a) => a.key === ch)
        if (!def) return false
        const Overlay = def.overlay
        openOverlay(`action:${def.id}`, (close) => <Overlay close={close} />)
        return true
      },
      quit: () => renderer.destroy(),
      help: () => {
        const shown = hints()
        openOverlay("help", (close) => <Help hints={shown} problems={problems()} close={close} />)
      },
      switcher: () =>
        openOverlay("switcher", (close) => (
          <Switcher
            screens={screens}
            current={current().id}
            select={(id) => nav.go(id)}
            close={close}
            load={(count) => track(runWithContext(kernel.context(), count))}
          />
        )),
      slot(n) {
        const s = screens.find((x) => x.slot === n)
        if (s) nav.go(s.id)
      },
      back: () => nav.back(),
    }),
  )
  onCleanup(clearMessages)
  props.expose?.({ nav, idle })

  return (
    <AppContext.Provider value={{ kernel, registry, track }}>
      <NavContext.Provider value={nav}>
        <KeysContext.Provider value={keys}>
          <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
            <Header chip={`${current().slot} ${current().title} ▾`} crumbs={nav.crumbs()} badges={[]} date={longDate(kernel.clock.today())} />
            <box flexGrow={1} flexDirection="column" overflow="hidden">
              <Show when={!tooSmall()} fallback={<text>{`Terminal too small (need ${MIN_WIDTH}×${MIN_HEIGHT})`}</text>}>
                <LayerContext.Provider value={SCREEN_LAYER}>
                  <Show when={route().kind === "screen" ? current() : undefined} keyed fallback={<RecordPlaceholder nav={nav} />}>
                    {(s: Screen) => <s.component />}
                  </Show>
                </LayerContext.Provider>
              </Show>
            </box>
            <StatusBar hints={hints()} message={currentMessage()} />
            <For each={overlays()}>
              {(o) => (
                <box position="absolute" top={2} left={0} width="100%" alignItems="center" zIndex={10}>
                  <LayerContext.Provider value={o.id}>{o.render()}</LayerContext.Provider>
                </box>
              )}
            </For>
          </box>
        </KeysContext.Provider>
      </NavContext.Provider>
    </AppContext.Provider>
  )
}

// Until the record view arrives (Task 6), an open record shows its ref.
function RecordPlaceholder(props: { nav: Nav }) {
  const r = () => props.nav.route()
  return <text>{r().kind === "record" ? (r() as { ref: string }).ref : ""}</text>
}
