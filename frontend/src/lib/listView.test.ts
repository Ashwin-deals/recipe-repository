import { describe, expect, it } from "vitest";
import { makeItem, makeList } from "../test/fixtures";
import { applyPending, setChecked } from "./listView";

describe("list view", () => {
  const list = makeList([makeItem({ id: 1 }), makeItem({ id: 2, label: "1 onion", aisle: "Produce", checked: true })]);

  it("overlays queued changes and recounts", () => {
    const view = applyPending(list, { "1": true, "2": false });
    const items = view.groups.flatMap((g) => g.items);
    expect(items.map((i) => [i.id, i.checked, i.pending])).toEqual([[1, true, true], [2, false, true]]);
    expect(view.counts).toEqual({ total: 2, checked: 1, open: 1 });
  });

  it("leaves items without queued changes alone", () => {
    const items = applyPending(list, {}).groups.flatMap((g) => g.items);
    expect(items.map((i) => [i.checked, i.pending])).toEqual([[false, false], [true, false]]);
  });

  it("setChecked returns an updated copy", () => {
    const updated = setChecked(list, 1, true);
    expect(updated.groups[0]?.items[0]?.checked).toBe(true);
    expect(list.groups[0]?.items[0]?.checked).toBe(false);
  });
});
