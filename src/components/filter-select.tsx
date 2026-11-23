"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { buzz } from "./ui";

export function FilterSelect({ label, value, onChange, disabled, className, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `filter-select ${className}` : "filter-select"}>
      <select className="filter-select-input" aria-label={label} value={value} disabled={disabled} onChange={(event) => {
        buzz.tap();
        onChange(event.target.value);
      }}>
        {children}
      </select>
      <ChevronDown className="filter-select-chevron" size={15} aria-hidden="true" />
    </div>
  );
}
