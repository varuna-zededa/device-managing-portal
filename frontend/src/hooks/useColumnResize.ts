import { useState, useCallback, useEffect, useRef } from 'react';

interface ColumnConfig {
  id: string;
  minWidth?: number;
  defaultWidth?: number;
}

interface UseColumnResizeOptions {
  tableId: string;
  columns: ColumnConfig[];
  persistToStorage?: boolean;
}

interface UseColumnResizeReturn {
  columnWidths: Record<string, number>;
  setColumnWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  startResize: (columnId: string, startX: number) => void;
  isResizing: boolean;
  resizingColumn: string | null;
  resetWidths: () => void;
}

const DEFAULT_MIN_WIDTH = 30;
const DEFAULT_COLUMN_WIDTH = 150;
const RESIZE_VERSION_KEY = "table-column-resize-version";
const CURRENT_VERSION = "2";

function migrateStorage() {
  try {
    const stored = localStorage.getItem(RESIZE_VERSION_KEY);
    if (stored !== CURRENT_VERSION) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("table-column-widths-")) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(RESIZE_VERSION_KEY, CURRENT_VERSION);
    }
  } catch { /* ignore */ }
}

migrateStorage();

export const useColumnResize = ({
  tableId,
  columns,
  persistToStorage = true,
}: UseColumnResizeOptions): UseColumnResizeReturn => {
  const storageKey = `table-column-widths-${tableId}`;

  const getInitialWidths = useCallback((): Record<string, number> => {
    if (persistToStorage) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as Record<string, number>;
          const defaultWidths: Record<string, number> = {};
          columns.forEach((col) => {
            defaultWidths[col.id] = parsed[col.id] ?? col.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
          });
          return defaultWidths;
        }
      } catch (e) {
        console.warn('Failed to load column widths from storage:', e);
      }
    }
    const defaultWidths: Record<string, number> = {};
    columns.forEach((col) => {
      defaultWidths[col.id] = col.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
    });
    return defaultWidths;
  }, [columns, persistToStorage, storageKey]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(getInitialWidths);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const minWidthRef = useRef<number>(DEFAULT_MIN_WIDTH);

  const getMinWidth = useCallback(
    (columnId: string): number => columns.find((col) => col.id === columnId)?.minWidth ?? DEFAULT_MIN_WIDTH,
    [columns]
  );

  useEffect(() => {
    setColumnWidths((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const col of columns) {
        const minWidth = col.minWidth ?? DEFAULT_MIN_WIDTH;
        const defaultWidth = col.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
        const existing = prev[col.id];
        next[col.id] = existing !== undefined ? Math.max(minWidth, existing) : defaultWidth;
        if (next[col.id] !== existing) changed = true;
      }
      if (Object.keys(prev).some((id) => !columns.some((col) => col.id === id))) {
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [columns]);

  const startResize = useCallback(
    (columnId: string, startX: number) => {
      setResizingColumn(columnId);
      setIsResizing(true);
      startXRef.current = startX;
      startWidthRef.current = columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTH;
      minWidthRef.current = getMinWidth(columnId);
    },
    [columnWidths, getMinWidth]
  );

  useEffect(() => {
    if (!isResizing || !resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(minWidthRef.current, startWidthRef.current + delta);
      setColumnWidths((prev) => ({ ...prev, [resizingColumn]: newWidth }));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizingColumn(null);
    };

    document.body.classList.add('table-resizing');
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.classList.remove('table-resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizingColumn]);

  useEffect(() => {
    if (persistToStorage && Object.keys(columnWidths).length > 0) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(columnWidths));
      } catch (e) {
        console.warn('Failed to save column widths to storage:', e);
      }
    }
  }, [columnWidths, persistToStorage, storageKey]);

  const resetWidths = useCallback(() => {
    const defaultWidths: Record<string, number> = {};
    columns.forEach((col) => {
      defaultWidths[col.id] = col.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
    });
    setColumnWidths(defaultWidths);
    if (persistToStorage) {
      try {
        localStorage.removeItem(storageKey);
      } catch (e) {
        console.warn('Failed to remove column widths from storage:', e);
      }
    }
  }, [columns, persistToStorage, storageKey]);

  return { columnWidths, setColumnWidths, startResize, isResizing, resizingColumn, resetWidths };
};
