import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FabItem {
  id: string;
  label: string;
  onClick?: () => void;
  disabledReason?: string;
  icon?: ReactNode;
}

export interface FloatingAddButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tooltip?: string;
  className?: string;
  items?: FabItem[];
  menuAriaLabel?: string;
}

export function FloatingAddButton({
  onClick,
  disabled = false,
  disabledReason,
  tooltip,
  className,
  items,
  menuAriaLabel,
}: FloatingAddButtonProps) {
  const isMenuVariant = items !== undefined && items.length > 1;
  const singleClick = !isMenuVariant
    ? (items && items.length === 1 ? items[0].onClick : onClick)
    : undefined;

  const triggerClasses = cn(
    "fixed right-8 z-50 flex items-center justify-center",
    "h-14 w-14 rounded-full",
    "bg-primary text-primary-foreground",
    "shadow-lg shadow-primary/25",
    "hover:bg-primary/90 hover:scale-105",
    "active:scale-95",
    "transition-[transform,background-color] duration-150",
    className,
  );

  const bottomStyle = { bottom: '2rem' };

  if (!isMenuVariant) {
    if (disabled) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span style={bottomStyle} className={cn(triggerClasses, "cursor-not-allowed opacity-50")}>
                <button
                  type="button"
                  disabled
                  aria-label={items?.[0]?.label ?? "Add"}
                  className="flex h-full w-full cursor-not-allowed items-center justify-center rounded-full bg-transparent text-current"
                >
                  <Plus className="h-6 w-6" />
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">{disabledReason ?? "You do not have permission to perform this action."}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    const button = (
      <button
        type="button"
        onClick={singleClick}
        style={bottomStyle}
        className={triggerClasses}
        aria-label={items?.[0]?.label ?? "Add"}
      >
        <Plus className="h-6 w-6" />
      </button>
    );

    if (tooltip) {
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="left">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return button;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          style={bottomStyle}
          className={triggerClasses}
          aria-label={menuAriaLabel ?? "Add options"}
        >
          <Plus className="h-6 w-6" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="mb-2">
        {items!.map((item) =>
          item.disabledReason ? (
            <TooltipProvider key={item.id} delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <DropdownMenuItem disabled className="cursor-not-allowed opacity-50 gap-2">
                      {item.icon}
                      {item.label}
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">{item.disabledReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <DropdownMenuItem key={item.id} onClick={item.onClick} className="gap-2">
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
