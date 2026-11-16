// The project detail's Context tab: the project's long Markdown document, rendered with <markdown> inside a
// scrollbox. `↑↓` (and PgUp/PgDn) scroll, `e` edits in the built-in editor, `E` in $VISUAL/$EDITOR; both save with
// setContext (an empty text clears it). The header shows when it was last updated and how far it is scrolled.
import type { ScrollBoxRenderable } from "@opentui/core"
import { SyntaxStyle, type MarkdownRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  printable,
  shortDate,
  theme,
  useEditExternal,
  useKeys,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Hint,
} from "../../../kernel/tui/api"

export const EMPTY = "No context yet. Press e to write it, or let your MCP integration fill it in."
const HINTS: Hint[] = [
  { key: "↑↓", label: "scroll" },
  { key: "e", label: "edit" },
  { key: "E", label: "edit in $EDITOR" },
]

// The Markdown colours: headings in the accent, emphasis and code muted.
function markdownStyle(owner: ReturnType<typeof useRenderer>) {
  return SyntaxStyle.fromStyles(
    {
      default: { fg: theme.text },
      "markup.heading": { fg: theme.accent, bold: true },
      "markup.heading.1": { fg: theme.accent, bold: true },
      "markup.heading.2": { fg: theme.accent, bold: true },
      "markup.heading.3": { fg: theme.accent, bold: true },
      "markup.strong": { bold: true },
      "markup.italic": { italic: true },
      "markup.raw": { fg: theme.amber },
      "markup.link": { fg: theme.accent, underline: true },
      "markup.link.url": { fg: theme.muted },
      "markup.list": { fg: theme.accent },
    },
    owner.nativeScene,
  )
}

export function ProjectContext(props: { recordRef: string }) {
  const rt = useRuntime()
  const overlay = useOverlay()
  const keys = useKeys()
  const editExternal = useEditExternal()
  const renderer = useRenderer()
  keys.hints(HINTS)
  const syntax = markdownStyle(renderer)

  const q = useQuery(() => rt.self().read.getContext!({ project: props.recordRef }) as Promise<{ markdown: string | null; updatedAt: string | null }>, {
    key: () => props.recordRef,
  })
  const text = () => q.data()?.markdown ?? ""
  const [scroll, setScroll] = createSignal(0)
  let box: ScrollBoxRenderable | undefined
  const percent = createMemo(() => {
    scroll()
    if (box === undefined) return 0
    const max = box.scrollHeight - box.viewport.height
    return max <= 0 ? 100 : Math.min(100, Math.round((box.scrollTop / max) * 100))
  })
  const scrollBy = (delta: number) => {
    box?.scrollBy(delta)
    setScroll((n) => n + 1)
  }

  const save = async (markdown: string): Promise<{ ok: true } | { ok: false; error: unknown }> => {
    const r = await act(() => rt.self().write.setContext!({ project: props.recordRef, markdown }) as Promise<unknown>)
    return r.ok ? { ok: true } : r
  }
  const editBuiltin = () => overlay.openEditor({ title: "Context", initial: text(), save })
  const editOutside = async () => {
    const edited = await editExternal(text())
    if (edited !== null) await save(edited)
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    if (ch === "e") editBuiltin()
    else if (ch === "E") void editOutside()
    else if (key.name === "up" || ch === "k") scrollBy(-1)
    else if (key.name === "down" || ch === "j") scrollBy(1)
    else if (key.name === "pageup") scrollBy(-10)
    else if (key.name === "pagedown") scrollBy(10)
    else return
    key.preventDefault()
  })

  const updated = () => {
    const at = q.data()?.updatedAt
    return at === null || at === undefined ? "" : `updated ${shortDate(at.slice(0, 10))}`
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1}>
      <Show when={q.data() !== undefined}>
        <box flexDirection="row" height={1} flexShrink={0} gap={2}>
          <text fg={theme.text}>Context · markdown</text>
          <box flexGrow={1} />
          <Show when={text() !== ""}>
            <text fg={theme.muted}>{[updated(), `${percent()}%`].filter((s) => s !== "").join(" · ")}</text>
          </Show>
        </box>
        <Show when={text() !== ""} fallback={<text fg={theme.muted}>{EMPTY}</text>}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => {
              box = r
              r.onSizeChange = () => setScroll((n) => n + 1)
            }}
            flexGrow={1}
            minHeight={0}
          >
            <markdown ref={(r: MarkdownRenderable) => (r.onSizeChange = () => setScroll((n) => n + 1))} content={text()} syntaxStyle={syntax} />
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}
