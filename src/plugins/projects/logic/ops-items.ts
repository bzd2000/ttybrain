// The exposed write operations on milestones, deliverables, risks and decisions. Each returns the record with
// its `ref`; `describe` gives the change-set line (plugin reference §2). Every write needs an active project and
// active owners: archived ones are refused with a hint to restore them first.
import { Deleted, NonBlank, Type, ValidationError, type PluginContext, type Static } from "@ttybrain/api"
import { DeliverableRecord, DecisionRecord, DeliverableStatus, MilestoneRecord, RiskRecord, RiskType, Severity, type Items } from "./items"
import { clean, date, now, today } from "./ops-project"
import type { Store } from "./records"

const Ref = NonBlank()
const RefInput = Type.Object({ ref: Ref })
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const OptStr = Type.Optional(Type.String())

const AddMilestone = Type.Object({ project: Ref, title: NonBlank(), due: NonBlank() })
const EditMilestone = Type.Object({ ref: Ref, title: Type.Optional(NonBlank()), due: Type.Optional(NonBlank()) })
const Complete = Type.Object({ ref: Ref, date: OptStr })

const AddDeliverable = Type.Object({
  project: Ref,
  title: NonBlank(),
  owner: OptStr,
  due: OptStr,
  milestone: OptStr,
  status: Type.Optional(DeliverableStatus),
})
const EditDeliverable = Type.Object({
  ref: Ref,
  title: Type.Optional(NonBlank()),
  owner: Clearable,
  due: Clearable,
  milestone: Clearable,
})
const SetStatus = Type.Object({ ref: Ref, status: DeliverableStatus })

const AddRisk = Type.Object({
  project: Ref,
  title: NonBlank(),
  type: RiskType,
  severity: Severity,
  owner: OptStr,
  description: OptStr,
  mitigation: OptStr,
})
const EditRisk = Type.Object({
  ref: Ref,
  title: Type.Optional(NonBlank()),
  type: Type.Optional(RiskType),
  severity: Type.Optional(Severity),
  owner: Clearable,
  description: Clearable,
  mitigation: Clearable,
})

const AddDecision = Type.Object({ project: OptStr, title: NonBlank(), date: OptStr, description: OptStr, decidedBy: OptStr, meeting: OptStr })
const EditDecision = Type.Object({
  ref: Ref,
  project: Clearable,
  title: Type.Optional(NonBlank()),
  date: OptStr,
  description: Clearable,
  decidedBy: Clearable,
  meeting: Clearable,
})

type Obj = Record<string, unknown>
// Names of the fields an edit input gives.
const given = (i: Obj, fields: string[]) => fields.filter((f) => i[f] !== undefined)
// A date for a describe line: normalised when valid, as typed otherwise (describe never throws).
const shown = (input: string, field: string) => {
  try {
    return date(input, field)
  } catch {
    return input.trim()
  }
}

export function registerItemOps(ctx: PluginContext, store: Store, items: Items): void {
  const db = ctx.data
  const dateOf = (v: string | null | undefined, field: string) => (v === undefined || v === null ? v : date(v, field))

  ctx.expose({
    write: {
      // ---- milestones
      addMilestone: {
        input: AddMilestone,
        output: MilestoneRecord,
        describe: (i: Static<typeof AddMilestone>) => `+ milestone "${i.title.trim()}" (due ${shown(i.due, "due")})`,
        run: async (i: Static<typeof AddMilestone>) => {
          const p = await store.activeProject(i.project)
          const due = date(i.due, "due")
          const t = now()
          const res = await db
            .insertInto("milestone")
            .values({ project_id: p.id, title: i.title.trim(), due_date: due, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          return items.find("milestone", String(res.insertId))
        },
      },
      editMilestone: {
        input: EditMilestone,
        output: MilestoneRecord,
        describe: async (i: Static<typeof EditMilestone>) => {
          const ref = items.refOr("milestone", i.ref)
          const old = await items.find("milestone", i.ref).catch(() => null)
          const parts = given(i, ["title", "due"]).map((f) =>
            f === "due" && old ? `due ${old.due_date} → ${shown(i.due!, "due")}` : f,
          )
          return `~ ${ref} ${parts.length ? parts.join(", ") : "(no change)"}`
        },
        run: async (i: Static<typeof EditMilestone>) => {
          const m = await items.find("milestone", i.ref)
          await items.guardProject(m.project)
          await db
            .updateTable("milestone")
            .set({
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(i.due !== undefined ? { due_date: date(i.due, "due") } : {}),
              updated_at: now(),
            })
            .where("id", "=", m.id)
            .execute()
          return items.find("milestone", String(m.id))
        },
      },
      completeMilestone: {
        input: Complete,
        output: MilestoneRecord,
        describe: (i: Static<typeof Complete>) => `~ ${items.refOr("milestone", i.ref)} done`,
        run: async (i: Static<typeof Complete>) => {
          const m = await items.find("milestone", i.ref)
          await items.guardProject(m.project)
          await db
            .updateTable("milestone")
            .set({ done_date: i.date !== undefined ? date(i.date, "date") : today(), updated_at: now() })
            .where("id", "=", m.id)
            .execute()
          return items.find("milestone", String(m.id))
        },
      },
      deleteMilestone: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- milestone ${items.refOr("milestone", i.ref)} "${await items.labelOf("milestone", i.ref)}"`,
        run: async (i: { ref: string }) => {
          const m = await items.find("milestone", i.ref)
          await items.guardProject(m.project)
          // deliverable.milestone_id references milestone.id: unlink first, in this same write.
          await db.updateTable("deliverable").set({ milestone_id: null, updated_at: now() }).where("milestone_id", "=", m.id).execute()
          await db.deleteFrom("milestone").where("id", "=", m.id).execute()
          return { ref: m.ref, deleted: true as const }
        },
      },

      // ---- deliverables
      addDeliverable: {
        input: AddDeliverable,
        output: DeliverableRecord,
        describe: async (i: Static<typeof AddDeliverable>) => `+ deliverable "${i.title.trim()}" (${await store.codeLabel(i.project)})`,
        run: async (i: Static<typeof AddDeliverable>) => {
          const p = await store.activeProject(i.project)
          const owner = await items.ownerId(i.owner)
          const due = dateOf(i.due, "due")
          const milestone = await items.milestoneFor(i.milestone, p.id)
          const t = now()
          const status = i.status ?? "not_started"
          const res = await db
            .insertInto("deliverable")
            .values({
              project_id: p.id,
              title: i.title.trim(),
              owner_id: owner ?? null,
              due_date: due ?? null,
              status,
              milestone_id: milestone ?? null,
              delivered_date: status === "delivered" ? today() : null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return items.find("deliverable", String(res.insertId))
        },
      },
      editDeliverable: {
        input: EditDeliverable,
        output: DeliverableRecord,
        describe: (i: Static<typeof EditDeliverable>) => {
          const f = given(i, ["title", "owner", "due", "milestone"])
          return `~ ${items.refOr("deliverable", i.ref)} ${f.length ? f.join(", ") : "(no change)"}`
        },
        run: async (i: Static<typeof EditDeliverable>) => {
          const d = await items.find("deliverable", i.ref)
          await items.guardProject(d.project)
          const owner = await items.ownerId(i.owner)
          const milestone = await items.milestoneFor(i.milestone, d.project_id)
          const due = i.due === undefined || i.due === null || i.due.trim() === "" ? (i.due === undefined ? undefined : null) : date(i.due, "due")
          await db
            .updateTable("deliverable")
            .set({
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(owner !== undefined ? { owner_id: owner } : {}),
              ...(due !== undefined ? { due_date: due } : {}),
              ...(milestone !== undefined ? { milestone_id: milestone } : {}),
              updated_at: now(),
            })
            .where("id", "=", d.id)
            .execute()
          return items.find("deliverable", String(d.id))
        },
      },
      setDeliverableStatus: {
        input: SetStatus,
        output: DeliverableRecord,
        describe: async (i: Static<typeof SetStatus>) => {
          const d = await items.find("deliverable", i.ref).catch(() => null)
          return `~ ${items.refOr("deliverable", i.ref)} ${d ? d.status : "?"} → ${i.status}`
        },
        run: async (i: Static<typeof SetStatus>) => {
          const d = await items.find("deliverable", i.ref)
          await items.guardProject(d.project)
          if (d.status === i.status) return d // unchanged: no write, so status_changed_at keeps meaning "changed"
          await db
            .updateTable("deliverable")
            .set({
              status: i.status,
              status_changed_at: now(),
              // delivered_date follows the status: today when delivered, cleared when it moves back.
              delivered_date: i.status === "delivered" ? today() : null,
              updated_at: now(),
            })
            .where("id", "=", d.id)
            .execute()
          return items.find("deliverable", String(d.id))
        },
      },
      deleteDeliverable: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- deliverable ${items.refOr("deliverable", i.ref)} "${await items.labelOf("deliverable", i.ref)}"`,
        run: async (i: { ref: string }) => {
          const d = await items.find("deliverable", i.ref)
          await items.guardProject(d.project)
          await db.deleteFrom("deliverable").where("id", "=", d.id).execute()
          return { ref: d.ref, deleted: true as const }
        },
      },

      // ---- risks and issues
      addRisk: {
        input: AddRisk,
        output: RiskRecord,
        describe: (i: Static<typeof AddRisk>) => `+ ${i.type} "${i.title.trim()}" (${i.severity})`,
        run: async (i: Static<typeof AddRisk>) => {
          const p = await store.activeProject(i.project)
          const owner = await items.ownerId(i.owner)
          const t = now()
          const res = await db
            .insertInto("risk")
            .values({
              project_id: p.id,
              type: i.type,
              title: i.title.trim(),
              description: clean(i.description) ?? null,
              severity: i.severity,
              owner_id: owner ?? null,
              mitigation: clean(i.mitigation) ?? null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return items.find("risk", String(res.insertId))
        },
      },
      editRisk: {
        input: EditRisk,
        output: RiskRecord,
        describe: (i: Static<typeof EditRisk>) => {
          const f = given(i, ["title", "type", "severity", "owner", "description", "mitigation"])
          return `~ ${items.refOr("risk", i.ref)} ${f.length ? f.join(", ") : "(no change)"}`
        },
        run: async (i: Static<typeof EditRisk>) => {
          const r = await items.find("risk", i.ref)
          await items.guardProject(r.project)
          const owner = await items.ownerId(i.owner)
          await db
            .updateTable("risk")
            .set({
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(i.type !== undefined ? { type: i.type } : {}),
              ...(i.severity !== undefined ? { severity: i.severity } : {}),
              ...(owner !== undefined ? { owner_id: owner } : {}),
              ...(i.description !== undefined ? { description: clean(i.description) } : {}),
              ...(i.mitigation !== undefined ? { mitigation: clean(i.mitigation) } : {}),
              updated_at: now(),
            })
            .where("id", "=", r.id)
            .execute()
          return items.find("risk", String(r.id))
        },
      },
      closeRisk: {
        input: Complete,
        output: RiskRecord,
        describe: (i: Static<typeof Complete>) => `~ ${items.refOr("risk", i.ref)} closed`,
        run: async (i: Static<typeof Complete>) => {
          const r = await items.find("risk", i.ref)
          await items.guardProject(r.project)
          if (r.status === "closed") throw new ValidationError(`${r.ref} is already closed`, { hint: `it was closed on ${r.closed_date}` })
          await db
            .updateTable("risk")
            .set({ status: "closed", closed_date: i.date !== undefined ? date(i.date, "date") : today(), updated_at: now() })
            .where("id", "=", r.id)
            .execute()
          return items.find("risk", String(r.id))
        },
      },
      deleteRisk: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- risk ${items.refOr("risk", i.ref)} "${await items.labelOf("risk", i.ref)}"`,
        run: async (i: { ref: string }) => {
          const r = await items.find("risk", i.ref)
          await items.guardProject(r.project)
          await db.deleteFrom("risk").where("id", "=", r.id).execute()
          return { ref: r.ref, deleted: true as const }
        },
      },

      // ---- decisions (the project is optional)
      addDecision: {
        input: AddDecision,
        output: DecisionRecord,
        describe: async (i: Static<typeof AddDecision>) => {
          const where = [i.project ? await store.codeLabel(i.project) : "", i.meeting?.trim() ?? ""].filter(Boolean).join(", ")
          return `+ decision "${i.title.trim()}"${where ? ` (${where})` : ""}`
        },
        run: async (i: Static<typeof AddDecision>) => {
          const p = i.project === undefined || i.project.trim() === "" ? null : await store.activeProject(i.project)
          const meeting = await items.meetingId(i.meeting)
          const t = now()
          const res = await db
            .insertInto("decision")
            .values({
              project_id: p?.id ?? null,
              date: i.date !== undefined ? date(i.date, "date") : today(),
              title: i.title.trim(),
              description: clean(i.description) ?? null,
              decided_by: clean(i.decidedBy) ?? null,
              meeting_id: meeting ?? null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return items.find("decision", String(res.insertId))
        },
      },
      editDecision: {
        input: EditDecision,
        output: DecisionRecord,
        describe: (i: Static<typeof EditDecision>) => {
          const f = given(i, ["project", "title", "date", "description", "decidedBy", "meeting"])
          return `~ ${items.refOr("decision", i.ref)} ${f.length ? f.join(", ") : "(no change)"}`
        },
        run: async (i: Static<typeof EditDecision>) => {
          const d = await items.find("decision", i.ref)
          await items.guardProject(d.project)
          const project = i.project === undefined ? undefined : i.project === null || i.project.trim() === "" ? null : (await store.activeProject(i.project)).id
          const meeting = await items.meetingId(i.meeting)
          await db
            .updateTable("decision")
            .set({
              ...(project !== undefined ? { project_id: project } : {}),
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(i.date !== undefined ? { date: date(i.date, "date") } : {}),
              ...(i.description !== undefined ? { description: clean(i.description) } : {}),
              ...(i.decidedBy !== undefined ? { decided_by: clean(i.decidedBy) } : {}),
              ...(meeting !== undefined ? { meeting_id: meeting } : {}),
              updated_at: now(),
            })
            .where("id", "=", d.id)
            .execute()
          return items.find("decision", String(d.id))
        },
      },
      deleteDecision: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- decision ${items.refOr("decision", i.ref)} "${await items.labelOf("decision", i.ref)}"`,
        run: async (i: { ref: string }) => {
          const d = await items.find("decision", i.ref)
          await items.guardProject(d.project)
          await db.deleteFrom("decision").where("id", "=", d.id).execute()
          return { ref: d.ref, deleted: true as const }
        },
      },
    },
  })
}
