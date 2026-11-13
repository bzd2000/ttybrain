import { describe, expect, test } from "bun:test"
import { ValidationError } from "../errors"
import { CommandRegistry, type CommandDef } from "./commands"

const cmd = (thing: string, verb: string): CommandDef => ({ thing, verb, summary: `${verb} a ${thing}`, run: async () => ({ json: null, text: "" }) })

describe("CommandRegistry", () => {
  test("register, find, things, list; a duplicate thing verb throws", () => {
    const c = new CommandRegistry()
    c.register("projects", cmd("project", "add"))
    c.register("projects", cmd("action", "add"))
    c.register("people", cmd("person", "add"))
    expect(() => c.register("people", cmd("project", "add"))).toThrow(new ValidationError('command "project add" is already registered by plugin "projects"'))
    expect(c.find("project", "add")?.plugin).toBe("projects")
    expect(c.find("project", "add")?.def.summary).toBe("add a project")
    expect(c.find("project", "nope")).toBeUndefined()
    expect(c.things()).toEqual(["action", "person", "project"])
    expect(c.list().map((e) => `${e.def.thing} ${e.def.verb}`)).toEqual(["project add", "action add", "person add"])
  })

  test("remove(plugin) drops its commands only", () => {
    const c = new CommandRegistry()
    c.register("projects", cmd("project", "add"))
    c.register("people", cmd("person", "add"))
    c.remove("projects")
    expect(c.things()).toEqual(["person"])
    c.register("other", cmd("project", "add"))
    expect(c.find("project", "add")?.plugin).toBe("other")
  })
})

describe("CommandRegistry: kernel names", () => {
  test("the kernel's things and global flag names are reserved", () => {
    const c = new CommandRegistry()
    for (const thing of ["help", "guide", "plugin", "report"])
      expect(() => c.register("p", cmd(thing, "x"))).toThrow(new ValidationError(`"${thing}" is a kernel command; plugins cannot register it`))
    for (const flag of ["json", "db", "from-inbox", "yes", "help"])
      expect(() => c.register("p", { ...cmd("thing", flag), flags: { [flag]: { type: "boolean", description: "" } } })).toThrow(
        new ValidationError(`command "thing ${flag}": --${flag} is a global flag`),
      )
    expect(c.list()).toEqual([])
  })
})
