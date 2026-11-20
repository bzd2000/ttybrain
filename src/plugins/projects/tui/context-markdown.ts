// How the Context tab draws Markdown (screen design "Project context"): headings in the accent and bold with their
// `#` markers kept, `•` bullets muted, bold in the text colour, inline code amber, a link as its text in cyan and
// ` · url` muted, tables as plain columns under a muted header row. <markdown>'s own rendering conceals the heading
// markers, draws `-` bullets and `label (url)` links, so headings, paragraphs and simple lists are drawn here
// (renderNode); tables, code blocks, quotes, rules and lists with nested blocks keep the default rendering. As in the
// design, a heading sits right on top of what follows it, and a blank line follows every other block (the default
// blocks have one too).
import { BoxRenderable, fg, bold, italic, StyledText, SyntaxStyle, TextRenderable, type RenderContext, type TextChunk } from "@opentui/core"
import type { MarkdownOptions } from "@opentui/core"
import { theme } from "@ttybrain/api/tui"

type Token = { type: string; raw?: string; text?: string; href?: string; depth?: number; tokens?: Token[]; items?: Token[]; ordered?: boolean; start?: number | "" }
type Style = { color: string; bold?: boolean; italic?: boolean }

// The default rendering's colours: the table header takes `markup.heading` (muted here, as headings are drawn
// below), code and quotes their usual scopes.
export function contextStyle(ctx: { nativeScene: unknown }): SyntaxStyle {
  return SyntaxStyle.fromStyles(
    {
      default: { fg: theme.text },
      conceal: { fg: theme.muted },
      "markup.heading": { fg: theme.muted },
      "markup.strong": { fg: theme.text, bold: true },
      "markup.italic": { italic: true },
      "markup.raw": { fg: theme.amber },
      "markup.link": { fg: theme.muted },
      "markup.link.label": { fg: theme.cyan },
      "markup.link.url": { fg: theme.muted },
      "markup.list": { fg: theme.muted },
    },
    ctx.nativeScene as never,
  )
}

function chunk(text: string, s: Style): TextChunk {
  let c = fg(s.color)(text)
  if (s.bold) c = bold(c)
  if (s.italic) c = italic(c)
  return c
}

// The inline tokens as chunks, in `s` unless a token sets its own style.
function inline(tokens: Token[] | undefined, s: Style, out: TextChunk[] = []): TextChunk[] {
  for (const t of tokens ?? []) {
    if (t.type === "strong") inline(t.tokens, { ...s, bold: true }, out)
    else if (t.type === "em") inline(t.tokens, { ...s, italic: true }, out)
    else if (t.type === "codespan") out.push(chunk(t.text ?? "", { ...s, color: s.color === theme.text ? theme.amber : s.color }))
    else if (t.type === "link") {
      inline(t.tokens, { ...s, color: s.color === theme.text ? theme.cyan : s.color }, out)
      if (t.href && t.href !== t.text) out.push(chunk(` · ${t.href}`, { ...s, color: theme.muted }))
    } else if (t.type === "br") out.push(chunk("\n", s))
    else if (t.tokens) inline(t.tokens, s, out)
    else out.push(chunk(t.text ?? "", s))
  }
  return out
}

const plain: Style = { color: theme.text }
const text = (ctx: RenderContext, chunks: TextChunk[], marginBottom = 0) =>
  new TextRenderable(ctx, { content: new StyledText(chunks), wrapMode: "word", width: "100%", marginBottom })

// A list whose items hold only text (a tight list) or paragraphs; undefined for anything else.
function list(ctx: RenderContext, token: Token): BoxRenderable | undefined {
  const items = token.items ?? []
  const simple = items.every((item) => (item.tokens ?? []).every((t) => t.type === "text" || t.type === "paragraph" || t.type === "space"))
  if (!simple) return undefined
  const start = token.start === "" || token.start === undefined ? 1 : Number(token.start)
  const markers = items.map((_, i) => (token.ordered ? `${start + i}.` : "•"))
  const width = Math.max(...markers.map((m) => m.length))
  const box = new BoxRenderable(ctx, { flexDirection: "column", width: "100%", marginBottom: 1 })
  items.forEach((item, i) => {
    const row = new BoxRenderable(ctx, { flexDirection: "row", width: "100%" })
    row.add(new TextRenderable(ctx, { content: new StyledText([chunk(markers[i]!.padStart(width) + " ", { color: theme.muted })]), flexShrink: 0 }))
    // A loose item's paragraphs each start a new line, under the first one's text.
    const chunks = (item.tokens ?? [])
      .filter((t) => t.type !== "space")
      .flatMap((t, k) => (k > 0 ? [chunk("\n", plain), ...inline([t], plain)] : inline([t], plain)))
    row.add(new TextRenderable(ctx, { content: new StyledText(chunks), wrapMode: "word", flexGrow: 1, flexShrink: 1 }))
    box.add(row)
  })
  return box
}

// The renderNode for <markdown>: headings, paragraphs and simple lists as above, the rest by default.
export function contextRenderNode(ctx: RenderContext): NonNullable<MarkdownOptions["renderNode"]> {
  return (token) => {
    const t = token as unknown as Token
    if (t.type === "heading") {
      const s: Style = { color: theme.accent, bold: true }
      return text(ctx, [chunk(`${"#".repeat(t.depth ?? 1)} `, s), ...inline(t.tokens, s)])
    }
    if (t.type === "paragraph") return text(ctx, inline(t.tokens, plain), 1)
    if (t.type === "list") return list(ctx, t)
    return undefined
  }
}
