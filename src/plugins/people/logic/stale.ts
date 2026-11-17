// The one stale-contact rule, shared by the `staleStakeholders` read op and the People screen.
import { daysBetween } from "../../../kernel/api"

/** Never contacted, or last contact `days` or more days before `today`. */
export function isStale(lastContact: string | null, today: string, days: number): boolean {
  return lastContact === null || daysBetween(lastContact, today) >= days
}
