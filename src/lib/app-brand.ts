export const APP_NAME = "POP POS";

// Versioned URLs let installed apps fetch new artwork through the offline cache.
export const appIcons = {
  small: "/icon-192.png?v=popo-peek",
  large: "/icon-512.png?v=popo-peek",
  maskable: "/icon-maskable-512.png?v=popo-peek",
  apple: "/apple-touch-icon.png?v=popo-peek",
};

export const popoLoading = {
  poster: "/mascots/popo/poster.png",
  wave: "/mascots/popo/wave.webp",
};

export const popoClips = {
  curiousPeek: {
    webm: "/mascots/popo/curious-peek.webm",
    hevc: "/mascots/popo/curious-peek.mov",
  },
  victoryHop: {
    webm: "/mascots/popo/victory-hop.webm",
    hevc: "/mascots/popo/victory-hop.mov",
  },
};

export const popoPoses = {
  neutral: popoLoading.poster,
  welcome: "/mascots/popo/welcome.webp",
  menu: "/mascots/popo/menu.webp",
  sale: "/mascots/popo/sale.webp",
  plan: "/mascots/popo/plan.webp",
  connect: "/mascots/popo/connect.webp",
  close: "/mascots/popo/close.webp",
  team: "/mascots/popo/team.webp",
};

export const emptyStateObjects = {
  expense: "/empty-states/expense.webp",
  itemsSold: "/empty-states/items-sold.webp",
  payment: "/empty-states/payment.webp",
  salesReceipt: "/empty-states/sales-receipt.webp",
  shiftCalendar: "/empty-states/shift-calendar.webp",
  supplyBox: "/empty-states/supply-box.webp",
  mixingBowl: "/empty-states/mixing-bowl.webp",
  checklistClipboard: "/empty-states/checklist-clipboard.webp",
  costingCalculator: "/empty-states/costing-calculator.webp",
  inviteLink: "/empty-states/invite-link.webp",
  leaderboardTrophy: "/empty-states/leaderboard-trophy.webp",
  cashDrawer: "/empty-states/cash-drawer.webp",
  discountTag: "/empty-states/discount-tag.webp",
  marketStall: "/empty-states/market-stall.webp",
  categoryTag: "/empty-states/category-tag.webp",
  choiceTiles: "/empty-states/choice-tiles.webp",
} as const;
