// <TuiApp>: the frame (header, main area, status bar), the router that renders the current screen, the overlay
// stack (overlay.tsx: switcher, help, global actions and useOverlay's overlays) and the global key dispatch.
// Everything inside comes from the registry.
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { join } from "node:path"
import { For, onCleanup, Show, type Component, type JSX } from "solid-js"
import { runWithContext } from "../context"
import type { Kernel } from "../host"
import { Help } from "./components/Help"
import { OverviewScreen } from "./components/OverviewScreen"
import { RecordView } from "./components/RecordView"
import { Switcher, type SwitcherEntry } from "./components/Switcher"
import { bindDataSession, DataContext, useQuery } from "./data"
import { createDraftStore } from "./drafts"
import { longDate } from "./format"
import { CHIP_COLUMN, Header, StatusBar, type UnderCrumb } from "./frame"
import { createGlobalKeyHandler, frameHints, KeysContext, KeysStore, LayerContext, SCREEN_LAYER, useGlobalKeys, type Hint } from "./keys"
import { clearMessages, currentMessage, notify } from "./messages"
import { createNav, NavContext, OVERVIEW_ID, useNav, type Nav } from "./nav"
import { createOverlay, createOverlayStack, OverlayContext } from "./overlay"
import { createLiveRefresh } from "./refresh"
import { OVERVIEW_SLOT, type TuiRegistry } from "./registry"
import { AppContext, PluginScope, useApp } from "./scope"
import { theme } from "./theme"
import type { Route, StatusBadgeDef } from "./types"
import type { Registered } from "./registry"

export { PluginScope, useApp, type TuiAppContext } from "./scope"

export const MIN_WIDTH = 60
export const MIN_HEIGHT = 15

// What tests (renderTui) and the entry point get from a mounted app.
export type TuiHandle = {
  nav: Nav
  // Resolves once no tracked load (a query, a count) is in flight.
  idle(): Promise<void>
}

// The frame hints that stay in the status bar when the others do not fit.
const PINNED_HINTS = ["?", "q"]
// Screen 1's name (its route id stays OVERVIEW_ID).
export const ATTENTION_TITLE = "Attention"
// Behind an open overlay the header and the screen are dimmed: the theme background at 55% over them.
const BACKDROP = `${theme.bg}8c`
// The switcher drops down under the header chip, on the line under the header, starting 2 cells before the chip
// as the designs' `.menu` does (4 cells in, under `pm · `'s chip at 6).
const SWITCHER_PLACE = { top: 1, left: CHIP_COLUMN - 2 }
// Other overlays are centred across, with their middle at about 44% of the height between header and status bar.
const OVERLAY_ABOVE = 44
const OVERLAY_BELOW = 56

type Screen = SwitcherEntry & { component: Component<{}>; plugin?: string }

// The header for the current route. A record opened from another record's view whose crumb has `under` shows after
// that record's crumb, with the chip of that record's screen (`3 People ▾ › Anna Peeters › 1:1 Mon 23 Nov`).
function AppHeader(props: { chip(screen: string): string; badges: Array<Registered<StatusBadgeDef>>; date: string }) {
  const app = useApp()
  const nav = useNav()
  const pair = () => {
    const s = nav.stack()
    const top = s[s.length - 1]
    const below = s[s.length - 2]
    return top?.kind === "record" && below?.kind === "record" ? { top, below } : undefined
  }
  const under = useQuery(
    async (): Promise<(UnderCrumb & { ref: string; screen: string }) | null> => {
      const p = pair()
      if (p === undefined) return null
      const found = await app.kernel.records.resolveAny(p.top.ref)
      const def = found ? app.registry.crumbFor(found.type) : undefined
      if (!def?.under) return null
      const text = await Promise.resolve()
        .then(() => def.under!(p.top.ref, p.below.ref))
        .catch(() => null)
      return text === null ? null : { ref: p.top.ref, parent: p.below.ref, text, screen: p.below.screen }
    },
    { key: () => nav.stack().map((r) => (r.kind === "record" ? r.ref : r.screen)).join("\n") },
  )
  // Only while it is about the routes shown now (a reload keeps the last data).
  const current = () => {
    const u = under.data()
    const p = pair()
    return u && p && u.ref === p.top.ref && u.parent === p.below.ref ? u : undefined
  }
  return (
    <Header
      chip={props.chip(current()?.screen ?? nav.route().screen)}
      crumb={nav.crumb()}
      under={current()}
      screenCrumb={nav.screenCrumb()}
      badges={props.badges}
      date={props.date}
    />
  )
}

// `refreshMs`: how often live refresh checks PRAGMA data_version (spec §10: about every second); `draftMs`: how
// long after the last change a draft is written (drafts.ts, 1 s).
export function TuiApp(props: { kernel: Kernel; registry: TuiRegistry; refreshMs?: number; draftMs?: number; expose?: (handle: TuiHandle) => void }) {
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
  // Also waits for a scheduled refresh bump (after an own write): the reload it starts is tracked as well.
  const idle = async () => {
    while (inflight.size > 0 || refresh.pending()) {
      if (inflight.size > 0) await Promise.allSettled([...inflight])
      else await new Promise((r) => setTimeout(r, 0))
    }
  }

  const refresh = createLiveRefresh(kernel, props.refreshMs ?? 1000)
  onCleanup(() => refresh.stop())
  const session = { kernel, version: refresh.version, today: refresh.today, track }
  onCleanup(bindDataSession(session))

  // Drafts live next to the database's home, not in it; old ones go when the TUI starts.
  const drafts = createDraftStore({
    dir: join(kernel.paths.home, "drafts"),
    clock: kernel.clock,
    ...(props.draftMs !== undefined ? { delayMs: props.draftMs } : {}),
    onError: (e) => notify(`drafts: ${e instanceof Error ? e.message : String(e)}`, "error"),
  })
  drafts.prune()
  onCleanup(() => drafts.flushAll())

  const nav = createNav(kernel, registry, track)
  const stack = createOverlayStack()
  const keys = new KeysStore(() => stack.top() ?? SCREEN_LAYER)
  const openOverlay = (kind: string, render: (close: () => void) => JSX.Element) => void stack.push(render, kind)
  const overlay = createOverlay(stack, kernel, registry)
  nav.setFormOpener((recordType, formId, formProps) => void overlay.openForm(recordType, formId, formProps))
  onCleanup(() => nav.setFormOpener(undefined))

  const screens: Screen[] = [{ id: OVERVIEW_ID, title: ATTENTION_TITLE, slot: OVERVIEW_SLOT, component: OverviewScreen }, ...registry.screens()]
  const screenOf = (id: string) => screens.find((s) => s.id === id)
  const current = () => screenOf(nav.route().screen) ?? screens[0]!
  const route = () => nav.route()
  const tooSmall = () => dims().width < MIN_WIDTH || dims().height < MIN_HEIGHT

  const problems = () => [
    ...registry.errors().map((e) => e.error),
    // Failed plugins, and loaded ones with an error (a data step that failed: the plugin itself runs).
    ...kernel.plugins
      .filter((p) => p.status === "failed" || (p.status === "ok" && p.error !== undefined))
      .flatMap((p) => [`${p.id}: ${p.error ?? "failed"}`, ...(p.hint !== undefined ? [`  hint: ${p.hint}`] : [])]),
  ]
  // What loaded plugins' ctx.notices said at boot.
  const notices = () => kernel.plugins.flatMap((p) => (p.notices ?? []).map((n) => `${p.id}: ${n}`))
  // On a screen (not in an overlay, not while typing) the bar is the screen's hints, then the global actions'
  // (`i capture`, unless an exact registration says `globals: false`), then the frame's (`g or 1-7 screens`,
  // `? help`, `q quit`, or those an exact registration asks for).
  const lastSlot = Math.max(...screens.map((s) => s.slot))
  const hints = () => {
    const own = keys.hints()
    if (keys.top() !== SCREEN_LAYER || keys.textFocused()) return own
    const wanted = keys.frameKeys()
    const tail: Hint[] = [
      ...(keys.globalHints() ? registry.globalActions().map((a) => ({ key: a.key, label: a.label })) : []),
      ...frameHints(lastSlot).filter((h) => wanted === undefined || wanted.includes(h.key)),
    ]
    const all = [...own, ...tail.filter((h) => !own.some((o) => o.key === h.key))]
    return [...all, ...keys.afterHints().filter((h) => !all.some((o) => o.key === h.key))]
  }
  const switcherOpen = () => stack.list().some((o) => o.kind === "switcher")

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
        openOverlay("help", (close) => <Help hints={shown} actions={registry.globalActions().map((a) => ({ key: a.key, label: a.label }))} problems={problems()} notices={notices()} close={close} />)
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
    <AppContext.Provider value={{ kernel, registry, track, version: refresh.version, drafts }}>
      <DataContext.Provider value={session}>
        <NavContext.Provider value={nav}>
          <KeysContext.Provider value={keys}>
            <OverlayContext.Provider value={overlay}>
              <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
                <AppHeader
                  chip={(screen) => {
                    const s = screenOf(screen) ?? current()
                    return `${s.slot} ${s.title} ${switcherOpen() ? "▴" : "▾"}`
                  }}
                  badges={registry.badges()}
                  date={longDate(refresh.today())}
                />
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
                <StatusBar hints={hints()} message={currentMessage()} width={dims().width} pinned={PINNED_HINTS} />
                <Show when={stack.list().length > 0}>
                  <box position="absolute" top={0} left={0} width="100%" height={Math.max(0, dims().height - 1)} backgroundColor={BACKDROP} zIndex={9} />
                </Show>
                <For each={stack.list()}>
                  {(o) =>
                    o.kind === "switcher" ? (
                      <box position="absolute" top={SWITCHER_PLACE.top} left={SWITCHER_PLACE.left} zIndex={10}>
                        <LayerContext.Provider value={o.id}>{o.render()}</LayerContext.Provider>
                      </box>
                    ) : (
                      <box position="absolute" top={1} left={0} width="100%" height={Math.max(0, dims().height - 2)} flexDirection="column" alignItems="center" zIndex={10}>
                        <box flexGrow={OVERLAY_ABOVE} flexShrink={1} />
                        <box flexShrink={0} flexDirection="column" alignItems="center" width="100%">
                          <LayerContext.Provider value={o.id}>{o.render()}</LayerContext.Provider>
                        </box>
                        <box flexGrow={OVERLAY_BELOW} flexShrink={1} />
                      </box>
                    )
                  }
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
