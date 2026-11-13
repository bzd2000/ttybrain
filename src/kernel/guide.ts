// The agent guide (`pm guide`): a kernel section on the CLI conventions, then every plugin's guide sections,
// in plugin load order (the order plugins first registered a section) and then by `order`.

export type GuideSection = { title: string; markdown: string; order?: number }

const KERNEL = `## Conventions

- Commands follow \`pm <thing> <verb> [args] [--flags]\`. \`pm help\` lists them.
- Add \`--json\` to any command for machine-readable output. With \`--json\`, errors print \`{"error":{"code","message","hint"}}\`.
- Exit codes: \`0\` OK, \`1\` validation error, \`2\` not found (the hint suggests close matches), \`3\` conflict or database busy (try again).
- Dates accept \`YYYY-MM-DD\`, \`today\`, \`tomorrow\`, \`+Nd\`, \`+Nw\` and \`mon\` to \`sun\` (the next such day). Output dates are always \`YYYY-MM-DD\`.
- References: any record by its display ID (\`A-12\`) or bare number (\`12\`), a project by code (\`CRM\` or \`#CRM\`), a person by handle (\`anna\` or \`@anna\`).
- When a change comes from an inbox item, pass \`--from-inbox I-<n>\` so pm records what the item became.
- Commands never prompt. Destructive commands need \`--yes\`.
- When something is ambiguous (which project, which person, whether something was decided), ask the user instead of guessing.`

export class GuideRegistry {
  private sections: Array<{ plugin: string; section: GuideSection }> = []

  section(plugin: string, section: GuideSection): void {
    this.sections.push({ plugin, section })
  }

  render(pmVersion: string): string {
    const plugins = [...new Set(this.sections.map((s) => s.plugin))]
    const sorted = this.sections
      .map((s, i) => ({ ...s, i }))
      .sort((a, b) => plugins.indexOf(a.plugin) - plugins.indexOf(b.plugin) || (a.section.order ?? 0) - (b.section.order ?? 0) || a.i - b.i)
    const blocks = [
      "# pm: guide for agents",
      `This is pm ${pmVersion}, a personal tool for following up projects, people and meetings. Use its CLI to read and record things for the user.`,
      KERNEL,
      ...sorted.map((s) => `## ${s.section.title}\n\n${s.section.markdown.trim()}`),
    ]
    return blocks.join("\n\n") + "\n"
  }

  remove(pluginId: string): void {
    this.sections = this.sections.filter((s) => s.plugin !== pluginId)
  }
}
