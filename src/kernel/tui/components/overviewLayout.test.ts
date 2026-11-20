// The Overview layout: alternating columns when they fit, balanced and capped when they do not.
import { describe, expect, test } from "bun:test"
import { layoutOverview, wrappedLines } from "./overviewLayout"

const full = (rows: number) => ({ rows, empty: "Nothing." })

describe("overview layout", () => {
  test("wrappedLines wraps by word and splits a word longer than the width", () => {
    expect(wrappedLines("No late milestones and none in the next 14 days.", 34)).toBe(2)
    expect(wrappedLines("short", 34)).toBe(1)
    expect(wrappedLines("abcdefghij", 4)).toBe(3)
  })

  test("a roomy screen keeps the alternating grid and shows up to 5 rows plus +N more", () => {
    const places = layoutOverview([full(7), full(0), full(3)], 38, 140)
    expect(places.map((p) => p.column)).toEqual([0, 1, 0])
    expect(places.map((p) => p.rows)).toEqual([5, 0, 3])
    expect(places[0]!.height).toBe(2 + 6)
  })

  test("a short screen balances the columns and caps rows so each column fits", () => {
    const needs = [full(6), full(0), full(6), full(0), full(6), { rows: 0, empty: "No one.", footer: "last contact 30+ days ago, high influence first" }, full(6)]
    const places = layoutOverview(needs, 22, 80)
    for (const c of [0, 1]) expect(places.filter((p) => p.column === c).reduce((s, p) => s + p.height, 0)).toBeLessThanOrEqual(22)
    for (const p of places) expect(p.height).toBeGreaterThanOrEqual(3)
    expect(places.filter((p, i) => needs[i]!.rows === 6).every((p) => p.rows >= 1 && p.rows <= 5)).toBe(true)
  })

  test("a roomy screen pairs the panels in grid rows: both panels of a row get the taller one's height", () => {
    const places = layoutOverview([full(3), full(3), full(4), { ...full(3), headings: 2 }, full(3), { ...full(2), footer: "last contact" }, full(3)], 34, 118)
    expect(places.map((p) => p.row)).toEqual([0, 0, 1, 1, 2, 2, 3])
    expect(places.map((p) => p.column)).toEqual([0, 1, 0, 1, 0, 1, 0])
    expect(places.map((p) => p.height)).toEqual([5, 5, 7, 7, 5, 5, 5])
    expect(places.map((p) => p.rows)).toEqual([3, 3, 4, 3, 3, 2, 3])
  })

  test("a grid row too tall for the screen is shrunk in priority order, keeping its pair equal", () => {
    const places = layoutOverview([full(7), full(1), full(7), full(1)], 13, 118)
    expect(places.map((p) => p.row)).toEqual([0, 0, 1, 1])
    expect(places.map((p) => p.height)).toEqual([7, 7, 6, 6])
    expect(places.map((p) => p.rows)).toEqual([4, 1, 3, 1])
  })

  test("when not even the grid's smallest rows fit, the columns are balanced instead (no grid rows)", () => {
    const places = layoutOverview([full(6), full(6), full(6), full(0), full(0)], 10, 80)
    expect(places.every((p) => p.row === undefined)).toBe(true)
    for (const c of [0, 1]) expect(places.filter((p) => p.column === c).reduce((s, p) => s + p.height, 0)).toBeLessThanOrEqual(10)
  })
})
