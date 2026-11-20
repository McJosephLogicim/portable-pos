"use client";

import { useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ListPlus, Plus, type LucideIcon } from "lucide-react";
import { blocked, reject, type Reason } from "@/lib/reject";
import { buzz } from "./ui";

export function AddMenu({
  singleLabel,
  onSingle,
  onBulk,
  disabled,
  blockedReason,
  className = "btn compact",
  SingleIcon = Plus,
  BulkIcon = ListPlus,
}: {
  singleLabel: string;
  onSingle: () => void;
  onBulk: () => void;
  disabled?: boolean;
  blockedReason?: Reason;
  className?: string;
  SingleIcon?: LucideIcon;
  BulkIcon?: LucideIcon;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [popup, setPopup] = useState<{ keyboard: boolean; dialog?: HTMLDialogElement }>();
  return (
    <Menu.Root
      modal={false}
      onOpenChange={(open, details) => {
        if (!open) return;
        if (blockedReason) {
          details.cancel();
          reject(trigger.current, blockedReason);
          return;
        }
        const { event } = details;
        buzz.tap();
        setPopup({
          keyboard: event instanceof KeyboardEvent || (event.type === "click" && "detail" in event && event.detail === 0),
          // Keep the popup interactive when the trigger is inside a native modal sheet.
          dialog: trigger.current?.closest("dialog") ?? undefined,
        });
      }}
    >
      <Menu.Trigger ref={trigger} className={`add-menu-trigger ${className}`} disabled={disabled} {...blocked(blockedReason)}>
        <Plus size={18} aria-hidden="true" /> <span className="button-label">Add</span>
      </Menu.Trigger>
      <Menu.Portal container={popup?.dialog}>
        <Menu.Positioner className="add-menu-positioner" align="end" sideOffset={8} positionMethod="fixed">
          <Menu.Popup className="add-menu-popup" data-keyboard={popup?.keyboard || undefined}>
            <Menu.Item onClick={onSingle}>
              <SingleIcon size={18} aria-hidden="true" /> {singleLabel}
            </Menu.Item>
            <Menu.Item onClick={onBulk}>
              <BulkIcon size={18} aria-hidden="true" /> Add bulk
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
