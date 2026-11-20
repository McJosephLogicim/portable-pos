import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/lib/settings";
import { withoutStockCosts } from "../src/lib/stock";
import { editStockList, stockListsOf } from "../src/lib/stock-lists";
import { parseCommand } from "../src/server/input";

const settings = {
  ...defaultSettings("PHP"),
  stockItems: [
    { id: "milk", name: "Milk", unit: "L", details: { kind: "ingredient", supplier: "Harbor Dairy", notes: "Keep cold" } },
    { id: "cream", name: "Cream", unit: "L", details: { supplier: " harbor dairy " } },
    { id: "sugar", name: "Sugar", unit: "kg", details: { supplier: "Market" } },
  ],
};

test("existing stock details become reusable and renaming updates all matching items", () => {
  const lists = stockListsOf(settings);
  assert.deepEqual(lists.supplier, ["Harbor Dairy", "Market"]);
  assert.deepEqual(lists.kind, ["Ingredient", "Packaging", "Consumable"]);
  const result = editStockList(settings, "supplier", "Harbor Dairy", " Harbor Farms ");
  assert.deepEqual(result.stockLists.supplier, ["Harbor Farms", "Market"]);
  assert.deepEqual(result.stockItems?.map((item) => item.details?.supplier), ["Harbor Farms", "Harbor Farms", "Market"]);
  assert.equal(result.stockItems?.[0].details?.notes, "Keep cold");
  assert.throws(() => editStockList(settings, "supplier", "Harbor Dairy", "market"), /already exists/);
  assert.throws(() => editStockList(settings, "supplier", "Harbor Dairy", ""), /before removing/);
});

test("unused options and custom stock types survive the settings command and stay off the till", () => {
  const { stockLists } = editStockList(settings, "category", undefined, "Syrups");
  const edited = editStockList({ ...settings, stockLists }, "kind", "Ingredient", "Perishable");
  const command = parseCommand({
    action: "settings",
    deviceId: "device",
    name: "Cafe",
    currency: "PHP",
    timeZone: "Asia/Manila",
    pin: "1234",
    settings: { ...settings, ...edited },
  });
  assert.equal(command.action, "settings");
  assert.deepEqual(stockListsOf(command.settings).category, ["Syrups"]);
  assert.equal(command.settings.stockItems?.[0].details?.kind, "Perishable");
  const removed = editStockList(command.settings, "kind", "Packaging", "");
  assert.deepEqual(stockListsOf({ ...command.settings, ...removed }).kind, ["Perishable", "Consumable"]);
  assert.equal(withoutStockCosts(command.settings).stockLists, undefined);
});
