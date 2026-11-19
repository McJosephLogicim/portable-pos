"use client";

import { useEffect } from "react";
import { CookingPot, LayoutGrid, ListPlus, Package, Tag } from "lucide-react";
import { isSimpleMode } from "@/lib/settings";
import { CategoriesPage, categoriesOf, ChoicesPage, choicesOf, MenuPage } from "./menu-settings";
import { Row, type EditorProps } from "./settings";
import { StockPage } from "./stock-settings";

export type RecipesPage = "menu" | "categories" | "choices" | "stock" | "prep";

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
    if (page === "stock" || page === "prep") return <StockPage key={page} {...props} prepOnly={page === "prep"} />;
  }

  const stock = state.business?.settings.stockItems ?? [];
  const count = (n: number) => n || "None";
  return (
    <div className="page narrow">
      <div className="page-top"><h1 className="headline">Recipes</h1></div>
      <div className="card card-list">
        <Row icon={<LayoutGrid size={18} />} title="Menu items" detail={count(state.menu.length)} onClick={() => onPage("menu")} />
        <Row icon={<Tag size={18} />} title="Categories" detail={count(categoriesOf(state.menu).length)} onClick={() => onPage("categories")} />
        <Row icon={<ListPlus size={18} />} title="Choices" detail={count(choicesOf(state.menu).length)} onClick={() => onPage("choices")} />
      </div>
      {!simple && (
        <div className="card card-list">
          <Row icon={<Package size={18} />} title="Stock items" detail={count(stock.length)} onClick={() => onPage("stock")} />
          <Row icon={<CookingPot size={18} />} title="Prep recipes" detail={count(stock.filter((item) => item.prep).length)} onClick={() => onPage("prep")} />
        </div>
      )}
    </div>
  );
}
