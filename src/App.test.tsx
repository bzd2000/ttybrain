import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { App } from "./App"

test("renders layout and switches section with arrow keys", async () => {
  const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
    width: 80,
    height: 20,
  })
  try {
    await renderOnce()
    let frame = captureCharFrame()
    expect(frame).toContain("OpenTUI App")
    expect(frame).toContain("Sections")
    expect(frame).toContain("Welcome")

    mockInput.pressArrow("down")
    await renderOnce()
    frame = captureCharFrame()
    expect(frame).toContain("Item 1")
  } finally {
    renderer.destroy()
  }
})
