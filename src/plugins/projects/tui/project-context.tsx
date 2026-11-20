// The project detail's Context tab (screen design "Project context"): the project's long Markdown document in a
// focused panel `Context · markdown`, rendered with <markdown> (drawn as context-markdown.ts says) inside a
// scrollbox. `↑↓` (and PgUp/PgDn) scroll, `e` edits in the built-in editor (keeping a draft per project), `E` in
// $VISUAL/$EDITOR; both save with setContext (an empty text clears it). The panel's footer shows when it was last
// updated and how far it is scrolled.
import type { MarkdownRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { contextRenderNode, contextStyle } from "./context-markdown"
import {
  act,
  Panel,
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
} from "@ttybrain/api/tui"

export const EMPTY = "No context yet. Press e to write it, or let your MCP integration fill it in."
// The status bar as the design draws it; the design's `e edit in $EDITOR` is two keys here (`e` the built-in
// editor, which also works where no external editor can run, `E` $EDITOR), so `E` comes last.
const HINTS: Hint[] = [
  { key: "↑↓", label: "scroll" },
  { key: "e", label: "edit" },
  { key: "←→", label: "tabs" },
  { key: "Esc", label: "back" },
]
const KEPT: Hint[] = [{ key: "E", label: "edit in $EDITOR" }]


export function ProjectContext(props: { recordRef: string }) {
  const rt = useRuntime()
  const overlay = useOverlay()
  const keys = useKeys()
  const editExternal = useEditExternal()
  const renderer = useRenderer()
  keys.hints(HINTS, { exact: true, frame: [], after: KEPT })
  const syntax = contextStyle(renderer)
  const renderNode = contextRenderNode(renderer)

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
  // One draft per project (the kernel keeps it as `projects:context:<ref>`).
  const editBuiltin = () => overlay.openEditor({ title: "Context", initial: text(), save, draftKey: `context:${props.recordRef}` })
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

  const footer = () => (text() === "" ? undefined : [updated(), `${percent()}%`].filter((s) => s !== "").join(" · "))

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Context · markdown" footer={q.data() === undefined ? undefined : footer()} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Show when={text() !== ""} fallback={<text fg={theme.muted}>{EMPTY}</text>}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => {
              box = r
              r.onSizeChange = () => setScroll((n) => n + 1)
            }}
            flexGrow={1}
            minHeight={0}
          >
            <markdown
              ref={(r: MarkdownRenderable) => (r.onSizeChange = () => setScroll((n) => n + 1))}
              content={text()}
              syntaxStyle={syntax}
              renderNode={renderNode}
              tableOptions={{ style: "columns", borders: false }}
            />
          </scrollbox>
          </Show>
        </Show>
      </Panel>
    </box>
  )
}
