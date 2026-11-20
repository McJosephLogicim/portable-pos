"use client";

import { useEffect } from "react";
import { Calculator, CookingPot, LayoutGrid, ListPlus, Package, Tag } from "lucide-react";
import { isSimpleMode } from "@/lib/settings";
import { CategoriesPage, categoriesOf, ChoicesPage, choicesOf, MenuPage } from "./menu-settings";
import { Row, type EditorProps } from "./settings";
import { StockPage } from "./stock-settings";
import { PricingRulesPage } from "./recipe-costing";

export type RecipesPage = "menu" | "categories" | "choices" | "stock" | "prep" | "costing" | "pricing";

export interface RecipesProps extends EditorProps {
  page: RecipesPage | null;
  onPage: (page: RecipesPage | null) => void;
}

export function RecipesScreen(props: RecipesProps) {
  const { page, onPage, state } = props;
  const simple = isSimpleMode(state.business?.settings);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  if (page === "menu") return <MenuPage key={page} {...props} />;
  if (page === "categories") return <CategoriesPage {...props} />;
  if (page === "choices") return <ChoicesPage {...props} />;
  if (!simple) {
    if (page === "costing") return <MenuPage key={page} {...props} costingView />;
    if (page === "stock" || page === "prep") return <StockPage key={page} {...props} prepOnly={page === "prep"} />;
    if (page === "pricing") return <PricingRulesPage {...props} />;
  }

  const stock = state.business?.settings.stockItems ?? [];
  const count = (n: number) => n || "None";
  return (
    <div className="page narrow">
      <div className="page-top"><h1 className="headline">Recipes</h1></div>
      <p className="group-title">Menu</p>
      <div className="card card-list">
        <Row
          icon={<LayoutGrid size={18} />}
          title="Menu items"
          description="What you sell, with prices and photos"
          detail={count(state.menu.length)}
          onClick={() => onPage("menu")}
        />
        <Row
          icon={<Tag size={18} />}
          title="Categories"
          description="The tabs on Sell, like Coffee or Bakery"
          detail={count(categoriesOf(state.menu).length)}
          onClick={() => onPage("categories")}
        />
        <Row
          icon={<ListPlus size={18} />}
          title="Choices"
          description="Sizes, milks and add-ons, set up once"
          detail={count(choicesOf(state.menu).length)}
          onClick={() => onPage("choices")}
        />
      </div>
      {!simple && (
        <>
          <p className="group-title">Stock and costing</p>
          <div className="card card-list">
            <Row
              icon={<Calculator size={18} />}
              title="Menu costing"
              description="Compare costs, margins and suggested prices"
              onClick={() => onPage("costing")}
            />
            <Row
              icon={<Package size={18} />}
              title="Stock items"
              description="What you buy and count each shift"
              detail={count(stock.filter((item) => !item.prep).length)}
              onClick={() => onPage("stock")}
            />
            <Row
              icon={<CookingPot size={18} />}
              title="Prep"
              description="What you make ahead, like syrups and creams"
              detail={count(stock.filter((item) => item.prep).length)}
              onClick={() => onPage("prep")}
            />
          </div>
        </>
      )}
    </div>
  );
}
