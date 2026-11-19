// The meeting record view's Export tab: the board pack (while the meeting is planned) or the minutes (once it is
// held or cancelled) as Markdown, from `read.report`, under a header naming the document and the file it writes.
// Keys: ↑↓ / PgUp / PgDn scroll, m switches between the board pack and the minutes, w writes the file into the
// export folder, y copies the Markdown to the clipboard (OSC 52).
import type { ScrollBoxRenderable } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import {
  notify,
  Panel,
  printable,
  theme,
  useCopyText,
  useKeys,
  useQuery,
  useRuntime,
  useScreenKeys,
  useWriteExport,
  type Hint,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { Lines } from "./prep-tab"

type Kind = "board" | "minutes"

const HINTS: Hint[] = [
  { key: "↑↓", label: "scroll" },
  { key: "m", label: "board/minutes" },
  { key: "w", label: "write file" },
  { key: "y", label: "copy" },
]
const TITLES: Record<Kind, string> = { board: "Board pack", minutes: "Minutes" }
const SLUG_MAX = 40
const PAGE = 10 // lines a PgUp/PgDn scrolls

// `<date>-<slug>.md` for the board pack, `<date>-<slug>-minutes.md` for the minutes. The slug is the title
// lowercased, each run of other characters than a-z0-9 a `-`, trimmed of `-`, cut to 40 characters; `meeting`
// when nothing is left.
export function exportFileName(m: { date: string; title: string }, kind: Kind): string {
  const slug =
    m.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX) || "meeting"
  return `${m.date}-${slug}${kind === "minutes" ? "-minutes" : ""}.md`
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ExportTab(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const keys = useKeys()
  const writeExport = useWriteExport()
  const copyText = useCopyText()
  keys.hints(HINTS)

  // The document m chose; until then the one the meeting's status calls for.
  const [chosen, setChosen] = createSignal<Kind | undefined>()
  const q = useQuery(
    async () => {
      const meeting = await store.meeting(props.recordRef)
      const kind: Kind = chosen() ?? (meeting.status === "planned" ? "board" : "minutes")
      const report = (await rt.self().read.report!({ meeting: meeting.ref, kind, format: "md" })) as { text: string; title: string }
      return { meeting, kind, text: report.text }
    },
    { key: () => [props.recordRef, chosen()] },
  )
  const fileName = () => {
    const d = q.data()
    return d === undefined ? "" : exportFileName(d.meeting, d.kind)
  }
  let box: ScrollBoxRenderable | undefined

  const write = async (name: string, text: string) => {
    try {
      notify(`wrote ${await writeExport(name, text)}`)
    } catch (e) {
      notify(message(e), "error")
    }
  }
  const copy = (text: string) => {
    if (copyText(text)) notify("copied to clipboard")
    else notify("the terminal did not accept the copy (OSC 52)", "error")
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const d = q.data()
    if (d === undefined) return
    const ch = printable(key)
    if (key.name === "up" || ch === "k") box?.scrollBy(-1)
    else if (key.name === "down" || ch === "j") box?.scrollBy(1)
    else if (key.name === "pageup") box?.scrollBy(-PAGE)
    else if (key.name === "pagedown") box?.scrollBy(PAGE)
    else if (ch === "m") {
      setChosen(d.kind === "board" ? "minutes" : "board")
      box?.scrollTo(0)
    } else if (ch === "w") void write(fileName(), d.text)
    else if (ch === "y") copy(d.text)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1}>
      <Show when={q.data()}>
        {(d: () => { kind: Kind; text: string }) => (
          <box flexDirection="row" height={1} flexShrink={0} gap={2}>
            <text fg={theme.text}>{TITLES[d().kind]}</text>
            <text fg={theme.muted}>{fileName()}</text>
          </box>
        )}
      </Show>
      <Panel title="Markdown" focused={keys.active()} grow>
        <scrollbox ref={(r: ScrollBoxRenderable) => (box = r)} flexGrow={1} minHeight={0}>
          <Lines text={q.data()?.text ?? ""} />
        </scrollbox>
      </Panel>
    </box>
  )
}
