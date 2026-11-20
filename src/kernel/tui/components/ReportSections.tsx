// Draws report section results (ReportSectionResult) as lines: a muted title, then one line per row (its mark's
// icon, then the cells joined with ` · `, in the mark's tone), the `empty` text when there are no rows, `text` as
// plain lines and `note` muted. A group heading is drawn once, before the first section of a group. It takes no keys;
// the caller puts it in a scrollbox. Lines truncate by display width.
//
// With `compact`, a section that has a compact form is drawn from it instead, as the meeting prep design does: a
// fact (`Health          ● amber  …`, the label muted in 16 cells) or a muted sub-heading and one line per entry in
// three columns: the icon (2 cells and a gap), the text, and the right-hand value in a column of 16 (narrower on a
// narrow box: the widest value shown). Sections follow each other without blank lines; a blank line follows the facts.
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ReportLine, ReportSectionResult, ReportSpan } from "../../reports"
import { displayWidth, truncate } from "../format"
import { theme, toneColor } from "../theme"

const UNMEASURED = 200 // the width before the first measure
const ICON = 3 // the icon column and its gap
const ASIDE = 16 // the right-hand column
const LABEL = 16 // a fact's label and its gap
const NARROW = 56 // below this width the right-hand column takes only what its values need

function rowLine(s: ReportSectionResult, i: number, skip: string[]) {
  const mark = s.marks?.[i] ?? null
  const cells = s.columns
    .filter((c) => !skip.includes(c))
    .map((c) => s.rows[i]![c])
    .filter((v) => v !== null && v !== undefined && String(v) !== "")
    .map((v) => String(v).replace(/\r?\n/g, " "))
  return { text: (mark?.icon ? `${mark.icon} ` : "") + cells.join(" · "), tone: mark?.tone }
}

// The spans that fit in `width` cells, the one that overflows cut with `…`.
function fitSpans(spans: ReportSpan[], width: number): ReportSpan[] {
  const out: ReportSpan[] = []
  let left = width
  for (const s of spans) {
    const w = displayWidth(s.text)
    if (w <= left) {
      out.push(s)
      left -= w
      continue
    }
    if (left > 0) out.push({ ...s, text: truncate(s.text, left) })
    break
  }
  return out
}

function Spans(props: { spans: ReportSpan[]; width: number }) {
  return (
    <box flexDirection="row" width={props.width} flexShrink={0} height={1}>
      <For each={fitSpans(props.spans, props.width)}>
        {(s) => (
          <text fg={toneColor(s.tone)} wrapMode="none" flexShrink={0}>
            {s.text}
          </text>
        )}
      </For>
    </box>
  )
}

// One compact line in `room` cells: icon, text, and the right-hand value in `aside` cells.
function CompactLine(props: { line: ReportLine; room: number; aside: number }) {
  const hasAside = () => props.line.aside !== undefined && props.aside > 0
  const textWidth = () => Math.max(1, props.room - ICON - (hasAside() ? props.aside + 1 : 0))
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <text fg={toneColor(props.line.icon?.tone)} width={ICON} flexShrink={0} wrapMode="none">
        {props.line.icon?.text ?? ""}
      </text>
      <Spans spans={props.line.text} width={textWidth()} />
      <Show when={hasAside()}>
        <text fg={toneColor(props.line.aside!.tone)} marginLeft={1} width={props.aside} flexShrink={0} wrapMode="none">
          {truncate(props.line.aside!.text, props.aside)}
        </text>
      </Show>
    </box>
  )
}

export function ReportSections(props: { sections: ReportSectionResult[]; skipColumns?: string[]; compact?: boolean }) {
  // Lines are cut to the measured width of the component (the box the caller gives it).
  const [width, setWidth] = createSignal(0)
  const room = () => (width() === 0 ? UNMEASURED : Math.max(1, width()))
  const heading = (i: number): string | undefined => {
    const g = props.sections[i]!.group
    return g !== undefined && g !== props.sections[i - 1]?.group ? g : undefined
  }
  const compactOf = (s: ReportSectionResult) => (props.compact ? s.compact : undefined)
  const isFact = (i: number) => {
    const s = props.sections[i]
    return s !== undefined && compactOf(s)?.fact === true
  }
  // The right-hand column: 16 cells, or on a narrow box the widest value the compact lines show.
  const aside = createMemo(() => {
    if (room() >= NARROW) return ASIDE
    const widths = props.sections.flatMap((s) => (compactOf(s)?.lines ?? []).map((l) => (l.aside ? displayWidth(l.aside.text) : 0)))
    return Math.min(ASIDE, Math.max(0, ...widths))
  })
  const label = (title: string) => (room() >= NARROW ? Math.max(LABEL, displayWidth(title) + 2) : displayWidth(title) + 2)

  return (
    <box
      flexDirection="column"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <For each={props.sections}>
        {(s, i) => {
          const c = () => compactOf(s)
          return (
            <box flexDirection="column" marginBottom={props.compact ? (isFact(i()) && !isFact(i() + 1) && i() < props.sections.length - 1 ? 1 : 0) : 1}>
              <Show when={heading(i())}>
                {(g: () => string) => (
                  <text wrapMode="none" fg={theme.text}>
                    <b>{truncate(g(), room())}</b>
                  </text>
                )}
              </Show>
              <Show
                when={c()}
                fallback={
                  <>
                    <text wrapMode="none" fg={theme.muted}>
                      {truncate(s.title, room())}
                    </text>
                    <Show when={s.rows.length > 0} fallback={<text wrapMode="none" fg={theme.muted}>{truncate(s.empty, room())}</text>}>
                      <For each={s.rows}>
                        {(_, r) => {
                          const line = () => rowLine(s, r(), props.skipColumns ?? [])
                          return <text wrapMode="none" fg={toneColor(line().tone)}>{truncate(line().text, room())}</text>
                        }}
                      </For>
                    </Show>
                    <Show when={s.text}>
                      {(t: () => string) => (
                        <For each={t().split("\n")}>{(l) => <text wrapMode="none" fg={theme.text}>{truncate(l, room())}</text>}</For>
                      )}
                    </Show>
                    <Show when={s.note}>{(n: () => string) => <text wrapMode="none" fg={theme.muted}>{truncate(n(), room())}</text>}</Show>
                  </>
                }
              >
                {(cc: () => NonNullable<ReportSectionResult["compact"]>) => {
                  const title = () => cc().title ?? s.title
                  const empty = () => cc().empty ?? s.empty
                  // The compact form's own note only: the section's is written for Markdown (ISO dates).
                  const note = () => cc().note
                  return (
                    <>
                      <Show
                        when={cc().fact}
                        fallback={
                          <>
                            <text wrapMode="none" fg={theme.muted}>
                              {truncate(title(), room())}
                            </text>
                            <For each={cc().lines}>{(l) => <CompactLine line={l} room={room()} aside={aside()} />}</For>
                          </>
                        }
                      >
                        {/* A fact: the label, then the first line's text (the next lines under it). */}
                        <For each={cc().lines.length === 0 ? [undefined] : cc().lines}>
                          {(l, n) => (
                            <box flexDirection="row" height={1} flexShrink={0}>
                              <text fg={theme.muted} width={Math.min(label(title()), room())} flexShrink={0} wrapMode="none">
                                {n() === 0 ? truncate(title(), room()) : ""}
                              </text>
                              <Spans
                                spans={l === undefined ? [{ text: empty(), tone: "muted" }] : l.text}
                                width={Math.max(1, room() - Math.min(label(title()), room()))}
                              />
                            </box>
                          )}
                        </For>
                      </Show>
                      <Show when={!cc().fact && cc().lines.length === 0 && empty() !== ""}>
                        <text wrapMode="none" fg={theme.muted}>
                          {truncate(empty(), room())}
                        </text>
                      </Show>
                      <Show when={note()}>{(n: () => string) => <text wrapMode="none" fg={theme.muted}>{truncate(n(), room())}</text>}</Show>
                    </>
                  )
                }}
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
