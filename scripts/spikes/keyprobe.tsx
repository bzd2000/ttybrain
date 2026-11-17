// Spike only (web-terminal feasibility). Not production code; not imported by the app.
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For } from "solid-js"

const ANSI16 = Array.from({ length: 16 }, (_, i) => i)

function grey(n: number) {
  const h = Math.min(255, n).toString(16).padStart(2, "0")
  return `#${h}${h}${h}`
}

function Probe() {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [events, setEvents] = createSignal<string[]>([])
  const [osc, setOsc] = createSignal("press y")
  const t0 = Date.now()

  useKeyboard((key) => {
    const line =
      `t=${Date.now() - t0}ms name=${JSON.stringify(key.name)} ctrl=${key.ctrl} meta=${key.meta} shift=${key.shift}` +
      ` seq=${JSON.stringify(key.sequence)}`
    setEvents((e) => [...e.slice(-12), line])
    if (key.name === "y") {
      const ok = renderer.copyToClipboardOSC52("pm spike")
      setOsc(`copyToClipboardOSC52 -> ${ok}; isOsc52Supported() -> ${renderer.isOsc52Supported()}`)
    }
    if (key.name === "q" && !key.ctrl) renderer.destroy()
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <text>{`size ${dims().width}x${dims().height}  (q quits, y = OSC52 copy)`}</text>
      <text>{osc()}</text>
      <box flexDirection="row" height={1}>
        <For each={ANSI16}>{(i) => <text bg={grey(i * 17)}>{" " + i.toString(16)}</text>}</For>
      </box>
      <box flexDirection="row" height={1}>
        <For each={Array.from({ length: 64 }, (_, i) => i)}>
          {(i) => (
            <text bg={`#${(i * 4).toString(16).padStart(2, "0")}${(255 - i * 4).toString(16).padStart(2, "0")}80`}>{" "}</text>
          )}
        </For>
      </box>
      <For each={events()}>{(l) => <text>{l}</text>}</For>
    </box>
  )
}

await render(() => <Probe />, { exitOnCtrlC: false })
