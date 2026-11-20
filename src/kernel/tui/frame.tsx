// The frame around every screen, as the screen designs draw it: the header (`ttybrain · `, the screen chip, the
// open record's breadcrumb, then the badges and the date on the right) and the status bar (the keys valid right
// now, as `key label` pairs 3 cells apart, or a message for 5 s).
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useQuery, useRecord } from "./data"
import { displayWidth, truncate } from "./format"
import { keyText, type Hint } from "./keys"
import type { Message } from "./messages"
import type { Registered } from "./registry"
import { PluginScope, useApp } from "./scope"
import { theme, toneColor } from "./theme"
import type { RecordCrumbDef, StatusBadgeDef } from "./types"

// One plugin badge: its text() through useQuery (live) in its tone, nothing while it is null or loading.
function Badge(props: { def: StatusBadgeDef }) {
  const q = useQuery(() => props.def.text())
  return <Show when={q.data()}>{(t: () => string) => <text fg={toneColor(props.def.tone)}>{t()}</text>}</Show>
}

// The crumb's muted tail, from the record type's crumb `detail` (run in its plugin's scope); none on null or a throw.
function CrumbDetail(props: { def: RecordCrumbDef; recordRef: string }) {
  const q = useQuery(() => Promise.resolve().then(() => props.def.detail?.(props.recordRef) ?? null).catch(() => null), { key: () => props.recordRef })
  return (
    <Show when={q.data()}>
      {(d: () => string) => (
        <text fg={theme.muted} flexShrink={1} wrapMode="none">
          {` · ${d()}`}
        </text>
      )}
    </Show>
  )
}

// `› <ref> <label>` for the open record (`#CRM` shows as `CRM`): the ref in its type's crumb tone, the label in
// text colour, then the crumb's muted detail. Only the ref, muted, until the record is resolved. The crumb takes the
// room the badges leave (the space between them gives way first); when that is too little, the detail is clipped,
// then the label is cut with `…`; the `› ` and the ref stay whole.
function RecordCrumb(props: { recordRef: string }) {
  const app = useApp()
  const rec = useRecord(() => props.recordRef)
  const shown = () => (props.recordRef.startsWith("#") ? props.recordRef.slice(1) : props.recordRef)
  // Memos: every reload gives new record data, and crumbFor builds a new object each call; without them the keyed
  // detail below would remount (and its tail blink out) on every live refresh.
  const type = createMemo(() => rec.type())
  const def = createMemo(() => {
    const t = type()
    return t === undefined ? undefined : app.registry.crumbFor(t)
  })
  // The crumb's measured width, and from it the room for the label (after `› `, the ref and a space).
  const [width, setWidth] = createSignal(0)
  const label = () => {
    const full = ` ${rec.label() ?? ""}`
    if (width() === 0) return full
    const room = width() - displayWidth(CRUMB_MARK) - displayWidth(shown())
    return room >= displayWidth(full) ? full : room < 2 ? "" : ` ${truncate(rec.label() ?? "", room - 1)}`
  }
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      overflow="hidden"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <text fg={theme.muted} flexShrink={0}>
        {CRUMB_MARK}
      </text>
      <Show when={rec.label() !== undefined} fallback={<text fg={theme.muted}>{shown()}</text>}>
        <text fg={toneColor(def()?.tone)} flexShrink={0}>
          {shown()}
        </text>
        <text fg={theme.text} flexShrink={0} wrapMode="none">
          {label()}
        </text>
        <Show when={def()} keyed>
          {(d: Registered<RecordCrumbDef>) => (
            <Show when={d.detail}>
              <PluginScope kernel={app.kernel} plugin={d.plugin} label={`${shown()} crumb`}>
                <CrumbDetail def={d} recordRef={props.recordRef} />
              </PluginScope>
            </Show>
          )}
        </Show>
      </Show>
    </box>
  )
}

const CRUMB_MARK = " › "
const HEADER_PADDING = 1
const BRAND = "ttybrain"
const BRAND_DOT = " · "
// The column where the chip (its padding cell) starts: the switcher drops down under it.
export const CHIP_COLUMN = HEADER_PADDING + displayWidth(BRAND + BRAND_DOT)

// `chip`: `<slot> <title> ▾` (▴ while the switcher is open); `crumb`: the open record's ref, if any, else
// `screenCrumb`: the screen's own crumb (useScreenCrumb). `badges` are rendered in the given order (the registry
// sorts them by `order`), each in its plugin's scope.
export function Header(props: {
  chip: string
  crumb: string | undefined
  screenCrumb?: string | undefined
  badges: Array<Registered<StatusBadgeDef>>
  date: string
}) {
  const app = useApp()
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      paddingLeft={HEADER_PADDING}
      paddingRight={HEADER_PADDING}
      backgroundColor={theme.panel}
    >
      <box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <text fg={theme.accent} attributes={TextAttributes.BOLD} flexShrink={0}>
          {BRAND}
        </text>
        <text fg={theme.muted} flexShrink={0}>
          {BRAND_DOT}
        </text>
        <box backgroundColor={theme.selectedBg} paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text fg={theme.accent}>{props.chip}</text>
        </box>
        <Show
          when={props.crumb}
          keyed
          fallback={
            <Show when={props.screenCrumb}>
              {(text: () => string) => (
                <box flexDirection="row" flexShrink={1} overflow="hidden">
                  <text fg={theme.muted}>{" › "}</text>
                  <text fg={theme.text}>{text()}</text>
                </box>
              )}
            </Show>
          }
        >
          {(ref: string) => <RecordCrumb recordRef={ref} />}
        </Show>
      </box>
      <box flexDirection="row" flexShrink={0} gap={2}>
        <For each={props.badges}>
          {(b) => (
            <PluginScope kernel={app.kernel} plugin={b.plugin} label={b.id}>
              <Badge def={b} />
            </PluginScope>
          )}
        </For>
        <text fg={theme.muted}>{props.date}</text>
      </box>
    </box>
  )
}

// The status bar's left padding and the gap between hints.
const BAR_PADDING = 1
const HINT_GAP = 3
const hintWidth = (h: Hint) => displayWidth(keyText(h.key)) + (h.alt === undefined ? 0 : 4 + displayWidth(keyText(h.alt))) + 1 + displayWidth(h.label)

// The hints that fit in `width` cells, whole: the `pinned` keys (help, quit) always stay, and the others are kept
// in order while they fit; a hint is never cut mid-word.
export function fitHints(hints: Hint[], width: number, pinned: string[] = []): Hint[] {
  const isPinned = (h: Hint) => pinned.includes(h.key)
  let used = BAR_PADDING + hints.filter(isPinned).reduce((n, h) => n + hintWidth(h) + HINT_GAP, 0)
  const keep = new Set<Hint>(hints.filter(isPinned))
  for (const h of hints) {
    if (isPinned(h)) continue
    const w = hintWidth(h) + HINT_GAP
    if (used + w - HINT_GAP > width) break
    used += w
    keep.add(h)
  }
  return hints.filter((h) => keep.has(h))
}

// One hint: the key (and its `alt`) in accent, the words muted: `enter open`, `g or 1-6 screens`.
function HintText(props: { hint: Hint }) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.accent}>{keyText(props.hint.key)}</text>
      <Show when={props.hint.alt}>
        {(alt: () => string) => (
          <>
            <text fg={theme.muted}>or</text>
            <text fg={theme.accent}>{keyText(alt())}</text>
          </>
        )}
      </Show>
      <text fg={theme.muted}>{props.hint.label}</text>
    </box>
  )
}

// `width`: the terminal width; hints that do not fit whole are dropped (`pinned` ones last).
export function StatusBar(props: { hints: Hint[]; message: Message | null; width: number; pinned?: string[] }) {
  return (
    <box height={1} flexShrink={0} flexDirection="row" gap={HINT_GAP} paddingLeft={BAR_PADDING} backgroundColor={theme.panel}>
      <Show
        when={props.message}
        fallback={<For each={fitHints(props.hints, props.width, props.pinned)}>{(hint) => <HintText hint={hint} />}</For>}
      >
        {(m: () => Message) => <text fg={m().kind === "error" ? theme.red : theme.text}>{m().text}</text>}
      </Show>
    </box>
  )
}
