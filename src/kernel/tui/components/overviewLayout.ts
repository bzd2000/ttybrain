// The Overview's layout: where each panel goes and how many lines it gets, so that every panel fits the screen
// height (no panel is cut off or pushed off-screen, so Tab never focuses an invisible one).
// - A grid when it fits (as the designs draw it): panels in pairs, in priority order, one pair per grid row (even
//   indexes left, odd right); both panels of a row start on the same line and get the taller one's height. A grid
//   taller than the screen starts every row at its smallest (each panel's title, borders, footer, headings and
//   one content line, or a row and `+N more` when it has more), then hands out the lines left one at a time to
//   the rows in priority order.
// - When not even that fits, the panels are placed in two columns balanced by height instead (no grid rows): the
//   split (kept in priority order within each column) that overflows the screen least, then the one whose taller
//   column is lowest, with the same handing out per column.
// - A lead (the first panel, with `lead`: its width against 1 for the other column) takes the left column of a
//   block at the top, as tall as it wants; the next panels stack on its right while they fit its height (at least
//   one; the last one is stretched so both columns end on the same line), and the rest follow in the grid below.
//   When the block and the rest's smallest grid do not fit the screen, the layout above is used instead. With a
//   lead every row (and both balanced columns) splits as the lead block does, so one column edge runs down the
//   screen (overviewColumns); without one the columns are equal halves.
// - A panel with rows shows at most MAX_ROWS, then `+N more`; capped, it shows fewer rows and a larger N.
import { displayWidth } from "../format"

export const MAX_ROWS = 5

// What a panel needs: its row count (undefined while loading), its empty text and footer, which wrap, the lines its
// sub-headings take (`headings`, beside its rows), and the fixed lines it adds once it has rows (`extra`: a header
// row, a detail block).
// `lead`: see above.
export type PanelNeed = { rows: number | undefined; empty: string; footer?: string; headings?: number; extra?: number; lead?: number }
// Where it goes: its column, its grid row (undefined when the columns are balanced instead), its height in lines
// (borders included) and how many rows it shows.
// `part`: "lead" or "side" for a panel in the lead block (`row` undefined there; the grid's rows count from 0 below it).
export type PanelPlace = { column: 0 | 1; row: number | undefined; height: number; rows: number; part?: "lead" | "side" }

// Lines `text` takes when word-wrapped at `width` (a word longer than the width is split).
export function wrappedLines(text: string, width: number): number {
  if (width <= 0) return 1
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const w = displayWidth(word)
    if (used > 0 && used + 1 + w <= width) {
      used += 1 + w
      continue
    }
    if (used > 0) lines++
    const k = Math.ceil(w / width) // a word starts a line; a long one takes k lines
    lines += k - 1
    used = w - (k - 1) * width
  }
  return lines
}

// The two columns' outer widths and the gap between them on an Overview `screenWidth` wide (after the screen's
// padding, 1+1). Equal halves: the gap takes the cell an uneven split leaves (1 or 2), so the outer edges stay on
// the screen's padding. With a lead's `weight`: `weight` : 1 of the width after a gap of 1, on every row.
export function overviewColumns(screenWidth: number, weight?: number): { left: number; right: number; gap: number } {
  const room = Math.max(0, screenWidth - 3)
  if (weight === undefined) {
    const half = Math.floor(room / 2)
    return { left: half, right: half, gap: 1 + (room % 2) }
  }
  const left = Math.round((room * weight) / (weight + 1))
  return { left, right: room - left, gap: 1 }
}

// The inner text widths of the two columns: each panel's border (1+1) and padding (1+1) off its column.
function textWidths(screenWidth: number, weight?: number): [number, number] {
  const c = overviewColumns(screenWidth, weight)
  return [c.left - 4, c.right - 4]
}

type Sized = { chrome: number; min: number; want: number; total: number | undefined }

function size(need: PanelNeed, textWidth: number): Sized {
  let chrome = 2 + (need.footer ? wrappedLines(need.footer, textWidth) : 0) + (need.headings ?? 0)
  const n = need.rows
  if (n === undefined) return { chrome, min: 1, want: 1, total: n }
  if (n > 0) chrome += need.extra ?? 0
  if (n === 0) {
    const lines = wrappedLines(need.empty, textWidth)
    return { chrome, min: 1, want: lines, total: n }
  }
  return { chrome, min: Math.min(n, 2), want: Math.min(n, MAX_ROWS) + (n > MAX_ROWS ? 1 : 0), total: n }
}

// Rows shown with `lines` content lines: all of them when they fit (and are at most MAX_ROWS), else one line
// goes to `+N more`.
function rowsIn(s: Sized, lines: number): number {
  const n = s.total ?? 0
  if (n === 0) return 0
  return n <= Math.min(lines, MAX_ROWS) ? n : Math.max(1, Math.min(lines - 1, MAX_ROWS))
}

// Above this many panels the columns are filled greedily instead of trying every split.
const EXACT_UP_TO = 12

// The column of each panel: alternating when that fits `height`; otherwise the split with the least overflow,
// then the lowest taller column (the first panel always on the left). Many panels: the shorter column so far.
function columns(heights: number[], height: number): Array<0 | 1> {
  const n = heights.length
  const pick = (mask: number): Array<0 | 1> => heights.map((_, i) => ((mask >> i) & 1) as 0 | 1)
  if (n > EXACT_UP_TO) {
    const used = [0, 0]
    return heights.map((h) => {
      const c: 0 | 1 = used[1]! < used[0]! ? 1 : 0
      used[c]! += h
      return c
    })
  }
  const scoreOf = (mask: number) => {
    const used = [0, 0]
    heights.forEach((h, i) => (used[(mask >> i) & 1]! += h))
    return [Math.max(0, used[0]! - height) + Math.max(0, used[1]! - height), Math.max(used[0]!, used[1]!)]
  }
  // Alternating (even indexes left, odd right) whenever it fits, so a roomy screen keeps the familiar grid.
  let alternating = 0
  for (let i = 1; i < n; i += 2) alternating |= 1 << i
  if (scoreOf(alternating)[0] === 0) return pick(alternating)
  let best = alternating
  let bestScore = scoreOf(alternating)
  for (let mask = 0; mask < 1 << n; mask += 2) {
    const score = scoreOf(mask)
    if (score[0]! < bestScore[0]! || (score[0] === bestScore[0] && score[1]! < bestScore[1]!)) {
      best = mask
      bestScore = score
    }
  }
  return pick(best)
}

export function layoutOverview(needs: PanelNeed[], screenHeight: number, screenWidth: number): PanelPlace[] {
  const lead = needs[0]?.lead
  const widths = textWidths(screenWidth, lead)
  if (lead !== undefined && needs.length > 1) {
    const placed = leadBlock(needs, widths, screenHeight)
    if (placed) return placed
  }
  return grid(needs, widths, screenHeight) ?? balanced(needs, widths, screenHeight)
}

function leadBlock(needs: PanelNeed[], [leftText, rightText]: [number, number], height: number): PanelPlace[] | undefined {
  const lead = size(needs[0]!, leftText)
  const leadH = lead.chrome + lead.want
  const side: Sized[] = [size(needs[1]!, rightText)]
  let sum = side[0]!.chrome + side[0]!.want
  for (let i = 2; i < needs.length; i++) {
    const s = size(needs[i]!, rightText)
    if (sum + s.chrome + s.want > leadH) break
    side.push(s)
    sum += s.chrome + s.want
  }
  const block = Math.max(leadH, sum)
  if (block > height) return undefined
  const restNeeds = needs.slice(1 + side.length)
  const rest = restNeeds.length === 0 ? [] : grid(restNeeds, [leftText, rightText], height - block)
  if (rest === undefined) return undefined
  const heights = side.map((s) => s.chrome + s.want)
  heights[heights.length - 1]! += block - sum
  return [
    { column: 0, row: undefined, height: block, rows: rowsIn(lead, Math.min(block - lead.chrome, lead.want)), part: "lead" },
    ...side.map((s, i): PanelPlace => ({ column: 1, row: undefined, height: heights[i]!, rows: rowsIn(s, Math.min(heights[i]! - s.chrome, s.want)), part: "side" })),
    ...rest,
  ]
}

// One line at a time to each entry (in order) below its `want`, while `left` lasts.
function handOut(lines: number[], want: number[], left: number): void {
  for (let gave = true; left > 0 && gave; ) {
    gave = false
    for (let i = 0; i < lines.length && left > 0; i++) {
      if (lines[i]! >= want[i]!) continue
      lines[i]!++
      left--
      gave = true
    }
  }
}

// The grid (each panel sized at its column's text width), or undefined when its smallest rows do not fit `height`.
function grid(needs: PanelNeed[], widths: [number, number], height: number): PanelPlace[] | undefined {
  const sized = needs.map((n, i) => size(n, widths[i % 2]!))
  const rows = Math.ceil(sized.length / 2)
  const pair = (r: number) => sized.slice(2 * r, 2 * r + 2)
  const min = Array.from({ length: rows }, (_, r) => Math.max(...pair(r).map((s) => s.chrome + s.min)))
  const want = Array.from({ length: rows }, (_, r) => Math.max(...pair(r).map((s) => s.chrome + s.want)))
  const used = min.reduce((a, b) => a + b, 0)
  if (used > height) return undefined
  const lines = [...min]
  handOut(lines, want, height - used)
  return sized.map((s, i) => {
    const h = lines[Math.floor(i / 2)]!
    return { column: (i % 2) as 0 | 1, row: Math.floor(i / 2), height: h, rows: rowsIn(s, Math.min(h - s.chrome, s.want)) }
  })
}

// Balanced columns; a panel is sized at the narrower column's text width (its column is not known yet).
function balanced(needs: PanelNeed[], widths: [number, number], height: number): PanelPlace[] {
  const sized = needs.map((n) => size(n, Math.min(...widths)))
  const column = columns(
    sized.map((s) => s.chrome + s.want),
    height,
  )
  const lines = sized.map((s) => s.min)
  for (const c of [0, 1] as const) {
    const mine = sized.map((_, i) => i).filter((i) => column[i] === c)
    const mineLines = mine.map((i) => lines[i]!)
    handOut(
      mineLines,
      mine.map((i) => sized[i]!.want),
      height - mine.reduce((sum, i) => sum + sized[i]!.chrome + sized[i]!.min, 0),
    )
    mine.forEach((i, k) => (lines[i] = mineLines[k]!))
  }
  return sized.map((s, i) => ({ column: column[i]!, row: undefined, height: s.chrome + lines[i]!, rows: rowsIn(s, lines[i]!) }))
}
