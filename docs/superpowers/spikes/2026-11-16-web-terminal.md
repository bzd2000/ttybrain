# Spike: pm in a web terminal (ttyd + xterm.js)

Phase 2 Task 3. The question: does pm's TUI work in a browser terminal, and do the keys it relies on get through?
Short answer: **yes, with one launcher setting (`COLORTERM=truecolor`) and one wording fix.** The R25 key
alternatives (`Ctrl+J` for a new line, `Esc` `s` for save) are enough. No key changes are needed.

Run on 2026-11-17, branch `feature/pm-phase2`.

## Method

- **Server:** `ttyd` 1.7.7 (the static `ttyd.x86_64` release; xterm.js is bundled in its page), bound to `127.0.0.1`:
  `ttyd --writable -i 127.0.0.1 -p 7681 <wrapper>`. The wrapper runs the app under
  `script -q -f -I in.log -O out.log`, so every byte in each direction is logged. Two servers: one ran
  `scripts/spikes/keyprobe.tsx` (shows each `KeyEvent`, the size, a colour strip, an OSC 52 copy on `y`), the other
  ran `pm` itself on a seeded scratch database (6 projects, 30 actions, 1 stakeholder).
- **Client:** headless Chromium 156, driven over the DevTools protocol from a small Node script (Node's built-in
  WebSocket, nothing installed). Keys went in with `Input.dispatchKeyEvent`. They are real `keydown` events, so
  xterm.js's own key handling turns them into bytes. In the page, `term.onData` recorded what xterm.js sent and a
  wrapped `term.write` timed what came back. Text was read from `term.buffer`, colours from its cell attributes.
- **Limits:** everything ran on localhost, so there is no network latency in the numbers. Chrome ran headless, so
  there was no window, address bar or real OS keyboard layer. Browser-reserved shortcuts were still handled by
  Chrome itself (see below), but test them once in a normal browser window before relying on this.

## Results

### Keys (what xterm.js sends, and what OpenTUI makes of it)

| Key | Bytes sent | OpenTUI `KeyEvent` | Distinct? |
|---|---|---|---|
| Enter | `\r` | `return` | yes |
| **Shift+Enter** | `\r` | `return`, shift=false | **no: same as Enter** |
| Ctrl+Enter | `\r` | `return` | no: same as Enter |
| Alt+Enter | `\x1b\r` | `return`, meta=true | yes |
| **Ctrl+J** | `\n` | `linefeed` | **yes** |
| Esc | `\x1b` | `escape` | yes (about 25 ms later than a letter, see latency) |
| ↑ ↓ ← → | `\x1b[A` `\x1b[B` `\x1b[D` `\x1b[C` | `up` `down` `left` `right` | yes |
| Shift+↓ | `\x1b[1;2B` | `down`, shift=true | yes |
| Del | `\x1b[3~` | `delete` | yes |
| Backspace | `\x7f` | `backspace` | yes |
| Tab / Shift+Tab | `\t` / `\x1b[Z` | `tab` / `tab` shift=true | yes |
| **Ctrl+S** | `\x13` | `s`, ctrl=true | **yes** |
| Alt+S | `\x1bs` | `s`, meta=true | yes |
| **Esc then s, quickly** | `\x1b` `s` (two sends) | **one** `s`, meta=true (Alt+S) | arrives as Alt+S |
| Ctrl+C | `\x03` | `c`, ctrl=true | yes |
| Ctrl+T | nothing | — | **browser: opened a new tab** |
| Ctrl+N | nothing | — | **browser: opened a new window** |
| Ctrl+W | nothing | — | **browser: closed the tab** (in the first run, pm's own tab) |

**Keyboard protocol: legacy.** OpenTUI asks for the kitty keyboard protocol (`CSI ? u`) and turns on
xterm's modifyOtherKeys (`CSI > 4 ; 1 m`). xterm.js answers neither, so OpenTUI stays on legacy encoding. That is why
Shift+Enter and Ctrl+Enter collapse into Enter. Most local terminals behave the same unless they speak the kitty
protocol, so this is not specific to the browser.

**Esc s:** a fast `Esc` `s` reaches pm as a single Alt+S. pm's `<Form>` and `<Editor>` already treat Alt+S as save,
and in pm all three ways saved: Ctrl+S, a fast Esc s and a slow Esc-then-s (120 ms apart). Esc alone still
cancelled. (Projects → `n`, checked against `pm project list` afterwards.)

**Ctrl+J:** in quick capture (`i`) it added a line, and the hint bar shows `Ctrl+J new line`. OpenTUI's `<textarea>`
maps `linefeed` to a new line by default.

**Shift+Enter in quick capture saves the item.** Enter means save there, and Shift+Enter is Enter. Someone who
expects a new line gets a saved, one-line item. The capture overlay's header comment (`capture.tsx:2`) says
"Shift+Enter or Ctrl+J … insert a newline", which is true only in a terminal that speaks the kitty protocol.

**Browser shortcuts:** Chrome does not let a page take Ctrl+W, Ctrl+T or Ctrl+N (nor Ctrl+Shift+T/W/N, Ctrl+Tab or
Ctrl+Q). This spike confirmed it for W, T and N even in headless mode. pm uses none of them. It uses Ctrl+S (a
page may take it, and xterm.js does), Ctrl+J (no browser binding) and Ctrl+C. That fits.

### Colours

- Without `COLORTERM`, OpenTUI sends **256-colour** codes (`48;5;n`: 320 of them, no `48;2;`). ttyd sets
  `TERM=xterm-256color` but not `COLORTERM`, so pm's theme gets rounded to the 256-colour palette.
- With `COLORTERM=truecolor` in the wrapped command, pm sent **truecolour** (2320 `48;2;` and 2320 `38;2;`, no
  `48;5;`). xterm.js shows it correctly (see the 120×40 screenshot check: the theme's colours, borders and selection
  bar match a local terminal).

### Resize

The terminal follows the browser window: after shrinking the viewport, xterm.js reported its new size, the probe
showed `size 96x26` right away, and pm redrew correctly at each size while the window was set to 120×40.

### OSC 52 (copy to the clipboard)

OpenTUI sent `ESC ] 52 ;` and `isOsc52Supported()` said `true`, but the browser clipboard did not change.
`navigator.clipboard` itself worked in the same page, so ttyd 1.7.7's xterm.js ignores OSC 52. pm does not copy
anything today. Any future copy feature needs another path in web mode, or a terminal with an OSC 52 handler (the
xterm.js clipboard addon).

### Latency and redraw (localhost, 120×40, from keydown to the bytes arriving in the page)

| What | First bytes | Last bytes | Size |
|---|---|---|---|
| A letter (probe) | 4–6 ms | | |
| Esc (probe) | 24–28 ms | | |
| `j`, moving the selection in pm | 2.5–5 ms | same | 1.7 KB, one write |
| Switching screen (`1`, `2`, `4`) in pm, a full redraw | 19–71 ms | 48–169 ms | 16–21 KB |
| Opening and closing the switcher (`g`, Esc) | 13 ms / 40 ms | 84 ms / 41 ms | about 7.5 KB |

Screen switches include pm's own database queries. Esc costs about 20 ms more than other keys because OpenTUI waits
to tell a lone Esc from the start of an escape sequence. On a remote link, add one round trip to each line.
A full 120×40 screen is about 20 KB, which is not a problem on any normal connection.

### Other observations

- OpenTUI turns on mouse tracking (`?1003h`, SGR `?1006h`) and focus events (`?1004h`). xterm.js reports both, so a
  focus change sends `\x1b[I`/`\x1b[O`, which pm ignores. Selecting text with the mouse needs xterm.js's
  modifier (Shift-drag). This was not tested.
- Synchronized output (`?2026`) is not supported by this xterm.js (it answered `0`). No tearing was seen at these
  sizes.

## Conclusion

**Recommended:** ttyd (1.7.x) in front of pm, run as

```
ttyd --writable -i 127.0.0.1 -p 7681 -t titleFixed=pm env COLORTERM=truecolor pm
```

behind something that does authentication and TLS (a reverse proxy, or at least ttyd's `-c user:password` with
`--ssl`). Keep ttyd's default "leave site?" prompt (`disableLeaveAlert` off) as a guard against a stray Ctrl+W. It was
not tested here, since headless Chrome shows no dialogs.

**Is R25 enough?** Yes. `Ctrl+J` reaches pm as a new line in every case tried, and `Esc` `s` saves whether it arrives
as two keys or as Alt+S. Nothing pm binds is taken by the browser.

**Changes for pm** (small; none blocks phase 2):

1. The web-terminal launcher must set `COLORTERM=truecolor`; otherwise the theme falls back to 256 colours.
2. Don't promise Shift+Enter. Fix `capture.tsx:2` (and anything else that says Shift+Enter adds a line) to name
   `Ctrl+J` as the new-line key and Shift+Enter only where the terminal tells them apart. The hint bars already say
   `Ctrl+J new line`.
3. Optional: also accept Alt+Enter (`return` with meta) as a new line. It arrives distinctly in xterm.js and in
   most local terminals.
4. A future clipboard feature can't rely on OSC 52 under ttyd 1.7.7.
5. Before the web phase, repeat the Ctrl+W/T/N and leave-prompt checks in a normal (not headless) browser window.
