import assert from "node:assert/strict";
import test from "node:test";
import { makeSale, stockLeft } from "../src/lib/domain";
import { newShift } from "../src/lib/demo";
import { defaultSettings } from "../src/lib/settings";
import { batchIngredientProblem, menuCost, menuRecipeCost, prepCost, stockCostRates, suggestedPrice, withoutStockCosts } from "../src/lib/stock";
import type { Product, StockItem } from "../src/lib/types";
import { parseCommand } from "../src/server/input";

const whip: StockItem = {
  id: "whip", name: "Whip Cream", unit: "L",
  purchase: { price: 22900, quantity: 1, yieldPercent: 95 },
};
const cream: StockItem = {
  id: "cream", name: "Sea Salt Cream", unit: "L",
  prep: { yieldQuantity: 1, uses: [{ stockId: whip.id, amount: 1 }] },
};

test("Sea Salt Cream uses the workbook's ingredient and yield and updates Matcha Sea Salt", () => {
  const purchased: StockItem[] = [
    { id: "cups", name: "Cups and Lids", unit: "piece", purchase: { price: 21500, quantity: 50 } },
    { id: "ice", name: "Ice", unit: "kg", purchase: { price: 5000, quantity: 1 } },
    { id: "straw", name: "Straw", unit: "piece", purchase: { price: 4400, quantity: 50 } },
    { id: "matcha", name: "Matcha Powder", unit: "g", purchase: { price: 300000, quantity: 100, yieldPercent: 98 } },
    { id: "milk", name: "Fresh Milk", unit: "L", purchase: { price: 8900, quantity: 1, yieldPercent: 98 } },
    { id: "stickers", name: "Cup Stickers", unit: "piece", purchase: { price: 12000, quantity: 100, yieldPercent: 96 } },
  ];
  function preview(ingredient: StockItem, prep: StockItem) {
    const rates = stockCostRates([...purchased, ingredient, prep]);
    const cost = (id: string, quantity: number) => rates.has(id) ? rates.get(id)! * quantity : undefined;
    return menuCost([
      cost("cups", 1), cost("ice", 0.14), cost("straw", 1),
      cost("matcha", 3), cost("milk", 0.045), cost("stickers", 1),
      cost(cream.id, 0.035),
    ], 19900);
  }
  const batch = prepCost(cream.prep!, new Map([[whip.id, whip]]))!;
  assert.equal(Math.round(batch.batch), 24105);
  assert.equal(Math.round(batch.unit * 0.035), 844);
  const recipe = preview(whip, cream);
  assert.ok(recipe);
  assert.equal(Math.round(recipe.cost), 11779);
  assert.equal(Math.round(recipe.profit!), 8121);
  assert.equal((recipe.margin! * 100).toFixed(2), "40.81");
  assert.equal(suggestedPrice(recipe.cost, 55, 500), 26500);

  const higherPrice = { ...whip, purchase: { ...whip.purchase!, price: 28500 } };
  assert.equal(Math.round(preview(higherPrice, cream)!.cost), 11985);
  const lowerYield = { ...cream, prep: { ...cream.prep!, yieldQuantity: 0.75 } };
  assert.equal(Math.round(preview(higherPrice, lowerYield)!.cost), 12335);
  assert.equal(preview({ ...whip, purchase: undefined }, cream), undefined);
  assert.equal(prepCost({ ...cream.prep!, extraBatchCost: 500 }, new Map([[whip.id, whip]]))!.batch, batch.batch + 500);
});

test("costing keeps fractional costs and distinguishes a free input from a missing one", () => {
  assert.equal(menuCost([]), undefined);
  assert.equal(menuCost([10, undefined], 100), undefined);
  assert.deepEqual(menuCost([0, 0.4, 0.4], 0), { cost: 0.8, profit: -0.8, margin: undefined });
  assert.equal(suggestedPrice(100, 100, 5), undefined);
  assert.equal(suggestedPrice(60, 70, 100), 200);
});

test("a batch of 12 cookies costs ingredients by batch and labor and other costs per serving", () => {
  // Flour ₱60, butter ₱100, chocolate ₱180 and eggs ₱20 for the batch.
  const lines = [6000, 10000, 18000, 2000];
  const result = menuRecipeCost(lines, 12, 800, 200, 9500);
  assert.deepEqual(result, {
    batchMaterialCost: 36000, materialPerServing: 3000, cost: 4000,
    profit: 5500, margin: 5500 / 9500,
  });
  assert.equal(suggestedPrice(result!.cost, 70, 500), 13500);
  assert.equal(menuRecipeCost(lines, 24, 800, 200)?.cost, 2500);
  assert.equal(menuRecipeCost(lines, 1, 0, 0)?.cost, 36000);
  assert.equal(menuRecipeCost([100], 3, 1, 1)?.cost, 100 / 3 + 2);
  assert.equal(menuRecipeCost([6000, undefined], 12, 800, 200), undefined);
  assert.equal(menuRecipeCost(lines, 0, 800, 200), undefined);
  assert.equal(menuRecipeCost(lines, 1.5, 800, 200), undefined);
});

test("the menu keeps batch data for costing and selling still consumes a finished cookie", () => {
  const stockItems = [{ id: "flour", name: "Flour", unit: "kg" }, { id: "cookie", name: "Cookie", unit: "piece" }];
  const product: Product = {
    id: "cookie-menu", name: "Cookie", category: "Bakery", price: 9500, groups: [],
    uses: [{ stockId: "cookie", amount: 1 }],
    costing: {
      batch: { servings: 12, uses: [{ stockId: "flour", amount: 0.5 }] },
      laborPerServing: 800,
      otherPerServing: 200,
    },
  };
  const command = parseCommand({ action: "menu", menu: [product], pin: "1234" });
  assert.equal(command.action, "menu");
  assert.deepEqual(command.menu, [product]);
  assert.equal(batchIngredientProblem(command.menu, stockItems), undefined);
  assert.match(batchIngredientProblem(command.menu, stockItems.slice(1)) ?? "", /missing/);
  const shift = {
    ...newShift("device", "business", 1, 0, command.menu, { ...defaultSettings("PHP"), currency: "PHP", stockItems }),
    stock: { flour: 2, cookie: 12 },
  };
  assert.equal(shift.menu[0].costing, undefined);
  const sale = makeSale({
    id: crypto.randomUUID(), shift, sequence: 1,
    cart: [{ productId: product.id, optionIds: [], quantity: 1 }],
    createdAt: shift.openedAt, tender: "cash", received: 10000,
    soldOut: [], stock: shift.stock,
  });
  assert.equal(sale.total, 9500);
  assert.deepEqual(stockLeft(shift, [sale]), { flour: 2, cookie: 11 });
});

test("settings accept optional purchase data and till settings omit it", () => {
  const milk = { id: "milk", name: "Milk", unit: "L" };
  const stockItems = [milk, whip, cream, {
    id: "matcha", name: "Matcha", unit: "g",
    purchase: { price: 300000, quantity: 100, yieldPercent: 98 },
  }];
  const command = {
    action: "settings", deviceId: "device", name: "Cafe", currency: "PHP", timeZone: "Asia/Manila", pin: "1234",
    settings: { ...defaultSettings("PHP"), stockItems },
  };
  const parsed = parseCommand(command);
  assert.equal(parsed.action, "settings");
  assert.deepEqual(parsed.settings.stockItems, stockItems);
  assert.deepEqual(withoutStockCosts(parsed.settings).stockItems, [
    milk, { id: whip.id, name: whip.name, unit: whip.unit }, { id: cream.id, name: cream.name, unit: cream.unit },
    { id: "matcha", name: "Matcha", unit: "g" },
  ]);
  assert.throws(() => parseCommand({
    ...command,
    settings: {
      ...command.settings,
      stockItems: [{ ...milk, purchase: { price: 100, quantity: 1, yieldPercent: 0 } }],
    },
  }));
  const withPrep = (items: StockItem[]) => parseCommand({
    ...command, settings: { ...command.settings, stockItems: items },
  });
  assert.throws(() => withPrep([cream]), /stock item that is missing/);
  assert.throws(() => withPrep([whip, { ...cream, prep: { ...cream.prep!, uses: [{ stockId: cream.id, amount: 1 }] } }]), /only use purchased/);
  assert.throws(() => withPrep([whip, { ...cream, prep: { ...cream.prep!, uses: [...cream.prep!.uses, ...cream.prep!.uses] } }]), /twice/);
  assert.throws(() => withPrep([whip, { ...cream, prep: { ...cream.prep!, yieldQuantity: 0 } }]));
});
