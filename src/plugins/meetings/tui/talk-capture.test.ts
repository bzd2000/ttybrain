// The text of a talk item made by quick capture: `talk` and the routing tags taken out, the first letter capitalised.
import { expect, test } from "bun:test"
import { tagsOf, talkText } from "./talk-capture"

test("tagsOf finds the person and project tags in order", () => {
  expect(tagsOf("talk @anna holiday planning around the CRM go-live #CRM")).toEqual(["@anna", "#CRM"])
  expect(tagsOf("talk about lunch (with @bob-2)")).toEqual(["@bob-2"])
  expect(tagsOf("mail a@b.com about #ERP")).toEqual(["#ERP"])
})

test("talkText leaves out `talk` and the tags, keeps the rest as typed", () => {
  expect(talkText("talk @anna holiday planning around the CRM go-live #CRM", ["@anna", "#CRM"])).toBe("Holiday planning around the CRM go-live")
  expect(talkText("Talk #ERP  vendor B   reference calls", ["#ERP"])).toBe("Vendor B reference calls")
  // A tag inside a longer word is not taken out.
  expect(talkText("talk @anna about @annabel's move", ["@anna"])).toBe("About @annabel's move")
  expect(talkText("talk @anna", ["@anna"])).toBe("")
})
