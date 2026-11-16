// <TuiApp>: the frame (header, main area, status bar), the router that renders the current screen, the overlay
// stack (overlay.tsx: switcher, help, global actions and useOverlay's overlays) and the global key dispatch.
// Everything inside comes from the registry.
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, onCleanup, Show, type Component, type JSX } from "solid-js"
import { runWithContext } from "../context"
import type { Kernel } from "../host"
import { Help } from "./components/Help"
import { OverviewScreen } from "./components/OverviewScreen"
import { RecordView } from "./components/RecordView"
import { Switcher, type SwitcherEntry } from "./components/Switcher"
import { bindDataSession, DataContext } from "./data"
import { longDate } from "./format"
import { Header, StatusBar } from "./frame"
import { createGlobalKeyHandler, FRAME_HINTS, KeysContext, KeysStore, LayerContext, SCREEN_LAYER, useGlobalKeys } from "./keys"
import { clearMessages, currentMessage } from "./messages"
import { createNav, NavContext, OVERVIEW_ID, type Nav } from "./nav"
import { createOverlay, createOverlayStack, OverlayContext } from "./overlay"
import { createLiveRefresh } from "./refresh"
import { OVERVIEW_SLOT, type TuiRegistry } from "./registry"
import { AppContext, PluginScope } from "./scope"
import { theme } from "./theme"
import type { Route } from "./types"

export { PluginScope, useApp, type TuiAppContext } from "./scope"

export const MIN_WIDTH = 60
export const MIN_HEIGHT = 15

// What tests (renderTui) and the entry point get from a mounted app.
export type TuiHandle = {
  nav: Nav
  // Resolves once no tracked load (a query, a count) is in flight.
  idle(): Promise<void>
}

type Screen = SwitcherEntry & { component: Component<{}>; plugin?: string }

// `refreshMs`: how often live refresh checks PRAGMA data_version (spec §10: about every second).
export function TuiApp(props: { kernel: Kernel; registry: TuiRegistry; refreshMs?: number; expose?: (handle: TuiHandle) => void }) {
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

  const refresh = createLiveRefresh(kernel, props.refreshMs ?? 1000)
  onCleanup(() => refresh.stop())
  const session = { kernel, version: refresh.version, track }
  onCleanup(bindDataSession(session))

  const nav = createNav(kernel, registry, track)
  const stack = createOverlayStack()
  const keys = new KeysStore(() => stack.top() ?? SCREEN_LAYER)
  const openOverlay = (kind: string, render: (close: () => void) => JSX.Element) => void stack.push(render, kind)
  const overlay = createOverlay(stack, kernel, registry)
  nav.setFormOpener((recordType, formId, formProps) => overlay.openForm(recordType, formId, formProps))
  onCleanup(() => nav.setFormOpener(undefined))

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
        openOverlay(`action:${def.id}`, (close) => (
          <PluginScope kernel={kernel} plugin={def.plugin} label={def.label} close={close}>
            <Overlay close={close} />
          </PluginScope>
        ))
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
    <AppContext.Provider value={{ kernel, registry, track, version: refresh.version }}>
      <DataContext.Provider value={session}>
        <NavContext.Provider value={nav}>
          <KeysContext.Provider value={keys}>
            <OverlayContext.Provider value={overlay}>
              <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
                <Header chip={`${current().slot} ${current().title} ▾`} crumbs={nav.crumbs()} badges={registry.badges()} date={longDate(kernel.clock.today())} />
                <box flexGrow={1} flexDirection="column" overflow="hidden">
                  <Show when={!tooSmall()} fallback={<text>{`Terminal too small (need ${MIN_WIDTH}×${MIN_HEIGHT})`}</text>}>
                    <LayerContext.Provider value={SCREEN_LAYER}>
                      <Show when={route().kind === "screen" ? current() : undefined} keyed fallback={<OpenRecord nav={nav} />}>
                        {(s: Screen) => (
                          <PluginScope kernel={kernel} plugin={s.plugin} label={s.title}>
                            <s.component />
                          </PluginScope>
                        )}
                      </Show>
                    </LayerContext.Provider>
                  </Show>
                </box>
                <StatusBar hints={hints()} message={currentMessage()} />
                <For each={stack.list()}>
                  {(o) => (
                    <box position="absolute" top={2} left={0} width="100%" alignItems="center" zIndex={10}>
                      <LayerContext.Provider value={o.id}>{o.render()}</LayerContext.Provider>
                    </box>
                  )}
                </For>
              </box>
            </OverlayContext.Provider>
          </KeysContext.Provider>
        </NavContext.Provider>
      </DataContext.Provider>
    </AppContext.Provider>
  )
}

// The record route's view; a new route (another record, or the same one reopened) mounts a fresh one.
function OpenRecord(props: { nav: Nav }) {
  const record = () => {
    const r = props.nav.route()
    return r.kind === "record" ? r : undefined
  }
  return <Show when={record()} keyed>{(r: Extract<Route, { kind: "record" }>) => <RecordView recordRef={r.ref} tab={r.tab} />}</Show>
}
