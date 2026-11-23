// Quick capture's routes (TuiContext.captureRoute): the capture overlay asks them, in registration order, whether a
// text is theirs; the first whose preview is not null has it (a `declined` preview still leaves it to the inbox).
import type { Registered } from "./registry"
import { useApp } from "./scope"
import type { CapturePreview, CaptureRouteDef } from "./types"

export type CaptureRoute = Registered<CaptureRouteDef>
export type CaptureMatch = { route: CaptureRoute; preview: CapturePreview }

// The routes the plugins registered (call during component setup).
export function useCaptureRoutes(): CaptureRoute[] {
  return useApp().registry.captureRoutes()
}

// The first route that takes `text` (a preview neither null nor declined), with its preview; without one, the first
// declined preview (its lines say why the text goes to the inbox); null when no route has anything to say. A
// preview that throws counts as null (a broken route never blocks capture).
export async function matchCapture(routes: CaptureRoute[], text: string): Promise<CaptureMatch | null> {
  let declined: CaptureMatch | null = null
  for (const route of routes) {
    const preview = await Promise.resolve()
      .then(() => route.preview(text))
      .catch(() => null)
    if (preview === null) continue
    if (preview.declined !== true) return { route, preview }
    declined ??= { route, preview }
  }
  return declined
}
