import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Header } from "./components/Header"
import { MainPanel } from "./components/MainPanel"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { sections } from "./sections"
import { theme } from "./theme"

type Pane = "sidebar" | "main"

export function App() {
  const renderer = useRenderer()
  const [selected, setSelected] = createSignal(0)
  const [focus, setFocus] = createSignal<Pane>("sidebar")

  // Global shortcuts. Arrow keys are handled by whichever component has focus.
  useKeyboard((key) => {
    if (key.name === "q") renderer.destroy()
    if (key.name === "tab") setFocus((f) => (f === "sidebar" ? "main" : "sidebar"))
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header title="OpenTUI App" subtitle="starter skeleton" />
      <box flexDirection="row" flexGrow={1}>
        <Sidebar sections={sections} focused={focus() === "sidebar"} onChange={setSelected} />
        <MainPanel section={sections[selected()]!} focused={focus() === "main"} />
      </box>
      <StatusBar
        hints={[
          { key: "↑↓", label: focus() === "sidebar" ? "select" : "scroll" },
          { key: "tab", label: "switch pane" },
          { key: "q", label: "quit" },
        ]}
      />
    </box>
  )
}
