import * as React from "react";
import { cn } from "@/lib/utils";
import { useColumnResize } from "@/hooks/useColumnResize";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { TruncatedCell } from "@/components/ui/truncated-cell";
import { CopyButton } from "@/components/ui/copy-button";
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical } from "lucide-react";

interface ResizableTableContextValue {
  columnWidths: Record<string, number>;
  startResize: (columnId: string, startX: number) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  beginKeyboardResize: () => void;
  endKeyboardResize: () => void;
  registerColumn: (columnId: string, config?: Omit<ColumnConfig, "id">) => void;
  autoFitColumns: () => void;
  autoFitColumn: (columnId: string) => void;
}

const ResizableTableContext = React.createContext<ResizableTableContextValue | null>(null);

const useResizableTable = () => {
  const context = React.useContext(ResizableTableContext);
  if (!context) {
    throw new Error("Resizable table components must be used within a ResizableTable");
  }
  return context;
};

interface ColumnConfig {
  id: string;
  minWidth?: number;
  defaultWidth?: number;
}

interface ResizableTableProps extends React.HTMLAttributes<HTMLTableElement> {
  tableId: string;
  children: React.ReactNode;
  persistWidths?: boolean;
  autoFitToContainer?: boolean;
  onAutoFitReady?: () => void;
  leadingColumns?: number;
  externalColumnOrder?: string[];
}

const ResizableTable = React.forwardRef<HTMLTableElement, ResizableTableProps>(
  ({ className, tableId, children, persistWidths = true, autoFitToContainer = true, onAutoFitReady, leadingColumns = 0, externalColumnOrder, ...props }, ref) => {
    const [columns, setColumns] = React.useState<ColumnConfig[]>([]);
    const [columnOrder, setColumnOrder] = React.useState<string[]>([]);
    const [containerWidth, setContainerWidth] = React.useState(0);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const keyboardResizingRef = React.useRef(false);

    const { columnWidths, startResize, isResizing, resetWidths, setColumnWidths } = useColumnResize({
      tableId,
      columns,
      persistToStorage: persistWidths,
    });

    const registerColumn = React.useCallback((columnId: string, config: Omit<ColumnConfig, "id"> = {}) => {
      setColumns((prev) => {
        const existing = prev.find((c) => c.id === columnId);
        if (existing) return prev;
        const newCol = { id: columnId, ...config };
        return [...prev, newCol];
      });
      setColumnOrder((prev) => {
        if (prev.includes(columnId)) return prev;
        return [...prev, columnId];
      });
    }, []);

    const setColumnWidth = React.useCallback((columnId: string, width: number) => {
      const col = columns.find((c) => c.id === columnId);
      const minWidth = col?.minWidth ?? 30;
      setColumnWidths((prev) => ({ ...prev, [columnId]: Math.max(minWidth, width) }));
    }, [columns, setColumnWidths]);

    const beginKeyboardResize = React.useCallback(() => {
      keyboardResizingRef.current = true;
    }, []);

    const endKeyboardResize = React.useCallback(() => {
      keyboardResizingRef.current = false;
    }, []);

    const autoFitColumn = React.useCallback((columnId: string) => {
      if (!containerRef.current) return;
      const cells = containerRef.current.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`);
      if (cells.length === 0) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let maxContentWidth = 0;
      cells.forEach((cell) => {
        // Measure only leaf .truncate elements so we get the correct font (e.g. font-medium
        // inner span) and avoid concatenated text from container .truncate wrappers.
        const truncEls = cell.querySelectorAll<HTMLElement>('.truncate');
        const leaves = Array.from(truncEls).filter((el) => !el.querySelector('.truncate'));
        const targets = leaves.length > 0 ? leaves : [cell];
        targets.forEach((textEl) => {
          const text = textEl.textContent?.trim() ?? '';
          if (!text) return;
          const s = window.getComputedStyle(textEl);
          ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
          maxContentWidth = Math.max(maxContentWidth, ctx.measureText(text).width);
        });
      });

      if (maxContentWidth === 0) return;

      const col = columns.find((c) => c.id === columnId);
      const minWidth = col?.minWidth ?? 30;
      // 32px cell padding + 40px copy-button + gap + 8px buffer
      const desiredWidth = Math.max(minWidth, Math.ceil(maxContentWidth) + 80);

      // Redistribute the other resizable columns so the total stays at container width.
      // Without this, autoFitColumns runs on the next load and scales everything back.
      const cw = containerRef.current.clientWidth;
      const fixedWidth = columnOrder.slice(0, leadingColumns).reduce(
        (sum, id) => sum + (columnWidths[id] ?? 150), 0
      );
      const remaining = cw - fixedWidth;
      const resizableCols = columnOrder.slice(leadingColumns);
      const otherCols = resizableCols.filter((id) => id !== columnId);
      const otherMinTotal = otherCols.reduce((sum, id) => {
        const c = columns.find((col) => col.id === id);
        return sum + (c?.minWidth ?? 30);
      }, 0);
      const cappedWidth = Math.min(desiredWidth, remaining - otherMinTotal);
      const availableForOthers = remaining - cappedWidth;
      const otherCurrentTotal = otherCols.reduce((sum, id) => sum + (columnWidths[id] ?? 150), 0);
      const otherScale = otherCurrentTotal > 0 ? availableForOthers / otherCurrentTotal : 1;

      setColumnWidths((prev) => {
        const newWidths: Record<string, number> = { ...prev, [columnId]: cappedWidth };
        otherCols.forEach((id) => {
          const c = columns.find((col) => col.id === id);
          const cMin = c?.minWidth ?? 30;
          newWidths[id] = Math.max(cMin, Math.floor((prev[id] ?? 150) * otherScale));
        });
        return newWidths;
      });
    }, [columnOrder, columnWidths, columns, leadingColumns, setColumnWidths]);

    const autoFitColumns = React.useCallback(() => {
      if (!containerRef.current || isResizing || keyboardResizingRef.current) return;
      const totalRegistered = columnOrder.length;
      if (totalRegistered === 0) return;
      const cw = containerRef.current.clientWidth;
      if (cw === 0) return;
      const fixedCols = leadingColumns;
      const fixedWidth = columnOrder.slice(0, fixedCols).reduce((sum, id) => sum + (columnWidths[id] ?? 150), 0);
      const remaining = cw - fixedWidth;
      const resizableCols = columnOrder.slice(fixedCols);
      if (resizableCols.length === 0) return;
      const totalResizable = resizableCols.reduce((sum, id) => sum + (columnWidths[id] ?? 150), 0);
      if (totalResizable === 0) return;
      const scale = remaining / totalResizable;
      const newWidths: Record<string, number> = { ...columnWidths };
      resizableCols.forEach((id) => {
        const col = columns.find((c) => c.id === id);
        const minWidth = col?.minWidth ?? 30;
        newWidths[id] = Math.max(minWidth, Math.floor((columnWidths[id] ?? 150) * scale));
      });
      setColumnWidths(newWidths);
      onAutoFitReady?.();
    }, [columnOrder, columnWidths, columns, isResizing, leadingColumns, onAutoFitReady, setColumnWidths]);

    React.useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
      if (autoFitToContainer && containerWidth > 0 && !isResizing && !keyboardResizingRef.current) {
        autoFitColumns();
      }
    }, [containerWidth]);

    const colGroup = React.useMemo(() => {
      const order = externalColumnOrder ?? columnOrder;
      if (order.length === 0) return null;
      return (
        <colgroup>
          {order.map((id, i) => (
            <col key={id} style={i < leadingColumns ? undefined : { width: columnWidths[id] ?? 150 }} />
          ))}
        </colgroup>
      );
    }, [externalColumnOrder, columnOrder, columnWidths, leadingColumns]);

    return (
      <ResizableTableContext.Provider
        value={{ columnWidths, startResize, setColumnWidth, beginKeyboardResize, endKeyboardResize, registerColumn, autoFitColumns, autoFitColumn }}
      >
        <div ref={containerRef} className="relative w-full overflow-x-auto">
          <table
            ref={ref}
            className={cn("w-full caption-bottom text-sm border-collapse", className)}
            style={{ borderCollapse: "collapse" }}
            {...props}
          >
            {colGroup}
            {children}
          </table>
        </div>
      </ResizableTableContext.Provider>
    );
  },
);
ResizableTable.displayName = "ResizableTable";

interface ResizableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  columnId: string;
  minWidth?: number;
  defaultWidth?: number;
  isLast?: boolean;
  tooltipContent?: React.ReactNode;
  enableTooltip?: boolean;
  sortDirection?: "asc" | "desc" | null;
  onSort?: () => void;
  sortLeading?: React.ReactNode;
}

function SortIcon({ sortDirection, onSort }: { sortDirection?: "asc" | "desc" | null; onSort?: () => void }) {
  if (sortDirection === "asc") return <ChevronUp aria-hidden="true" className="h-3.5 w-3.5 ml-1 shrink-0" />;
  if (sortDirection === "desc") return <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 ml-1 shrink-0" />;
  if (onSort) return <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 ml-1 shrink-0 opacity-40" />;
  return null;
}

const ResizableTableHead = React.forwardRef<HTMLTableCellElement, ResizableTableHeadProps>(
  ({ className, columnId, minWidth = 60, defaultWidth = 150, isLast = false, tooltipContent, enableTooltip = true, sortDirection, onSort, sortLeading, draggable, children, onClick, ...props }, ref) => {
    const { columnWidths, startResize, registerColumn, autoFitColumn } = useResizableTable();

    React.useEffect(() => {
      registerColumn(columnId, { minWidth, defaultWidth });
    }, [columnId, minWidth, defaultWidth, registerColumn]);

    const width = columnWidths[columnId] ?? defaultWidth;

    return (
      <th
        ref={ref}
        scope="col"
        draggable={draggable}
        data-column-id={columnId}
        className={cn(
          "relative h-12 px-4 text-left align-middle font-medium text-muted-foreground select-none",
          onSort && "cursor-pointer hover:text-foreground",
          draggable && "cursor-grab active:cursor-grabbing",
          className,
        )}
        style={{ width, overflow: "hidden" }}
        onClick={onSort ? (e) => { e.stopPropagation(); onSort(); } : onClick}
        {...props}
      >
        <div className="flex items-center min-w-0">
          {draggable && (
            <GripVertical aria-hidden="true" className="w-3 h-3 mr-1 text-muted-foreground/40 shrink-0 pointer-events-none" />
          )}
          {sortLeading}
          {onSort ? (
            <button
              type="button"
              className="flex items-center min-w-0 truncate text-inherit"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onSort(); }}
            >
              <span className="truncate">{children}</span>
              <SortIcon sortDirection={sortDirection} onSort={onSort} />
            </button>
          ) : (
            <span className="truncate">{children}</span>
          )}
        </div>
        {!isLast && (
          <div
            draggable={false}
            className="resize-handle"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResize(columnId, e.clientX);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              autoFitColumn(columnId);
            }}
          />
        )}
      </th>
    );
  },
);
ResizableTableHead.displayName = "ResizableTableHead";

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return extractText(props.children);
  }
  return "";
}

const COPYABLE_COLUMNS = new Set([
  "name", "title", "description", "serialNumber", "eveVersion",
  "location", "hardwareModel", "fqdn", "path", "region", "subnet",
  "gateway", "domain", "dns", "url", "version", "model",
  "id", "uuid", "email", "username",
]);

interface ResizableTableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  columnId: string;
  truncate?: boolean;
  tooltipContent?: React.ReactNode;
  copyValue?: string;
}

const ResizableTableCell = React.forwardRef<HTMLTableCellElement, ResizableTableCellProps>(
  ({ className, columnId, children, truncate = true, tooltipContent, copyValue, ...props }, ref) => {
    const shouldCopy = copyValue !== undefined || COPYABLE_COLUMNS.has(columnId);
    const textForCopy = copyValue ?? (shouldCopy ? extractText(children) : "");
    const showCopy = shouldCopy && textForCopy.length > 0 && textForCopy !== "—" && textForCopy !== "-";

    return (
      <td
        ref={ref}
        data-column-id={columnId}
        className={cn("relative p-4 align-middle [&:has([role=checkbox])]:pr-0 group/cell", className)}
        style={{ overflow: "hidden", maxWidth: 0 }}
        {...props}
      >
        {truncate ? (
          <div className="flex items-center min-w-0">
            <TruncatedCell tooltipContent={tooltipContent} className="truncate flex-1 min-w-0">
              {children}
            </TruncatedCell>
            {showCopy && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                <CopyButton value={textForCopy} />
              </div>
            )}
          </div>
        ) : (
          children
        )}
      </td>
    );
  },
);
ResizableTableCell.displayName = "ResizableTableCell";

const useAutoFitColumns = () => {
  const context = React.useContext(ResizableTableContext);
  return context?.autoFitColumns ?? null;
};

export {
  ResizableTable,
  ResizableTableHead,
  ResizableTableCell,
  useAutoFitColumns,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableCaption,
  Table,
  TableHead,
  TableCell,
};
