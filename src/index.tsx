import { render } from "@opentui/solid"
import { App } from "./App"

await render(() => <App />, { exitOnCtrlC: true })
