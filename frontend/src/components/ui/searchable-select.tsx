import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsTruncated } from "@/hooks/useIsTruncated";

function TruncatingTitleLabel({ label, className }: { label: string; className?: string }) {
  const [ref, isTruncated] = useIsTruncated<HTMLSpanElement>([label]);
  return (
    <span ref={ref} title={isTruncated ? label : undefined} className={cn("min-w-0 flex-1 truncate", className)}>
      {label}
    </span>
  );
}

export interface SearchableSelectOption {
  value: string;
  label: string;
  hint?: string;
  searchText?: string;
  group?: string;
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  onSearchChange?: (query: string) => void;
  isSearching?: boolean;
  groupTabs?: readonly string[];
  hintBelow?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  onSearchChange,
  isSearching = false,
  groupTabs,
  hintBelow = false,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activeGroup, setActiveGroup] = React.useState<string | undefined>(groupTabs?.[0]);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const listboxId = React.useId();
  const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSearch = search.length > 0;

  const visibleGroupTabs = React.useMemo(() => {
    if (!groupTabs) return [];
    return groupTabs.filter((g) => options.some((o) => o.group === g));
  }, [groupTabs, options]);

  const filtered = React.useMemo(() => {
    let base = options;
    if (!hasSearch && activeGroup) {
      base = base.filter((o) => o.group === activeGroup);
    }
    if (hasSearch) {
      const q = search.toLowerCase();
      base = base.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.hint?.toLowerCase().includes(q) ||
          o.searchText?.toLowerCase().includes(q),
      );
    }
    return base;
  }, [options, search, hasSearch, activeGroup]);

  const selectedOption = options.find((o) => o.value === value);

  const handleSearch = (q: string) => {
    setSearch(q);
    setHighlightedIndex(0);
    if (onSearchChange) {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => onSearchChange(q), 300);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[highlightedIndex]) {
      e.preventDefault();
      onValueChange(filtered[highlightedIndex].value);
      setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", triggerClassName, className)}
        >
          <TruncatingTitleLabel label={selectedOption?.label ?? placeholder} />
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)}
        onKeyDown={handleKeyDown}
        align="start"
      >
        <div className="flex items-center border-b border-border px-3 py-2 gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isSearching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {visibleGroupTabs.length > 1 && (
          <div className="flex gap-6 border-b border-border px-3 pt-2">
            {visibleGroupTabs.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => { setActiveGroup(group); setHighlightedIndex(0); }}
                className={cn(
                  "relative min-h-9 pb-2 text-sm font-medium transition-colors",
                  "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                  !hasSearch && activeGroup === group
                    ? "text-foreground after:bg-primary"
                    : "text-muted-foreground after:bg-transparent hover:text-foreground",
                )}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        <VirtualizedList
          key={`${activeGroup || "all"}-${search}`}
          listboxId={listboxId}
          options={filtered}
          value={value}
          highlightedIndex={highlightedIndex}
          onHighlight={setHighlightedIndex}
          isSearching={isSearching}
          emptyMessage={emptyMessage}
          hintBelow={hintBelow}
          onSelect={(v) => { onValueChange(v); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

function VirtualizedList({
  listboxId,
  options,
  value,
  highlightedIndex,
  onHighlight,
  isSearching,
  emptyMessage,
  hintBelow,
  onSelect,
}: {
  listboxId: string;
  options: SearchableSelectOption[];
  value?: string;
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  isSearching: boolean;
  emptyMessage: string;
  hintBelow?: boolean;
  onSelect: (value: string) => void;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => hintBelow ? 52 : 36,
    overscan: 8,
  });

  React.useEffect(() => {
    if (options.length > 0) {
      virtualizer.scrollToIndex(highlightedIndex, { align: "auto" });
    }
  }, [highlightedIndex, options.length, virtualizer]);

  if (options.length === 0) {
    return (
      <div id={listboxId} role="listbox" className="py-6 text-center text-sm text-muted-foreground">
        {isSearching ? "Searching..." : emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      id={listboxId}
      role="listbox"
      className="max-h-[320px] overflow-y-auto"
      style={{ overscrollBehavior: "contain" }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const option = options[virtualRow.index];
          return (
            <button
              key={`${option.group || "option"}-${option.value}`}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              onMouseEnter={() => onHighlight(virtualRow.index)}
              onClick={() => onSelect(option.value)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                (value === option.value || highlightedIndex === virtualRow.index) && "bg-accent/50",
              )}
            >
              <Check
                className={cn("w-4 h-4 shrink-0", value === option.value ? "opacity-100 text-primary" : "opacity-0")}
              />
              {hintBelow ? (
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="text-xs text-muted-foreground/60 truncate">{option.hint}</span>
                  )}
                </div>
              ) : (
                <>
                  <TruncatingTitleLabel label={option.label} />
                  {option.hint && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground/50">{option.hint}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
