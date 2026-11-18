// Draws report section results (ReportSectionResult) as lines: a title, then one line per row (its mark's icon,
// then the cells joined with ` · `, in the mark's tone), the `empty` text when there are no rows, `text` as plain
// lines and `note` muted. A group heading is drawn once, before the first section of a group. It takes no keys;
// the caller puts it in a scrollbox. Lines truncate by display width.
import { createSignal, For, Show } from "solid-js"
import type { ReportSectionResult } from "../../reports"
import { truncate } from "../format"
import { theme, toneColor } from "../theme"

const UNMEASURED = 200 // the width before the first measure

function rowLine(s: ReportSectionResult, i: number, skip: string[]) {
  const mark = s.marks?.[i] ?? null
  const cells = s.columns
    .filter((c) => !skip.includes(c))
    .map((c) => s.rows[i]![c])
    .filter((v) => v !== null && v !== undefined && String(v) !== "")
    .map((v) => String(v).replace(/\r?\n/g, " "))
  return { text: (mark?.icon ? `${mark.icon} ` : "") + cells.join(" · "), tone: mark?.tone }
}

export function ReportSections(props: { sections: ReportSectionResult[]; skipColumns?: string[] }) {
  // Lines are cut to the measured width of the component (the box the caller gives it).
  const [width, setWidth] = createSignal(0)
  const room = () => (width() === 0 ? UNMEASURED : Math.max(1, width()))
  const heading = (i: number): string | undefined => {
    const g = props.sections[i]!.group
    return g !== undefined && g !== props.sections[i - 1]?.group ? g : undefined
  }
  return (
    <box
      flexDirection="column"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <For each={props.sections}>
        {(s, i) => (
          <box flexDirection="column" marginBottom={1}>
            <Show when={heading(i())}>
              {(g: () => string) => (
                <text wrapMode="none" fg={theme.text}>
                  <b>{truncate(g(), room())}</b>
                </text>
              )}
            </Show>
            <text wrapMode="none" fg={theme.accent}>{truncate(s.title, room())}</text>
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
          </box>
        )}
      </For>
    </box>
  )
}
