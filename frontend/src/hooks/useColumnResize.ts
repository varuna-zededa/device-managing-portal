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

let _migrated = false;

export const useColumnResize = ({
  tableId,
  columns,
  persistToStorage = true,
}: UseColumnResizeOptions): UseColumnResizeReturn => {
  const storageKey = `table-column-widths-${tableId}`;

  // Run once per page load — only when at least one storage-backed table is mounted.
  if (persistToStorage && !_migrated) {
    migrateStorage();
    _migrated = true;
  }

  const getInitialWidths = useCallback((): Record<string, number> => {
    // NOTE: columns=[] at mount time, so we cannot use it here.
    // Return raw stored values; the [columns] effect will apply minWidth and fill
    // any missing columns with defaultWidth once columns register.
    if (persistToStorage) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) return JSON.parse(stored) as Record<string, number>;
      } catch (e) {
        console.warn('Failed to load column widths from storage:', e);
      }
    }
    return {};
  }, [persistToStorage, storageKey]);

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
      // Start from prev so stored values for not-yet-registered columns
      // survive as columns register one by one.
      const next: Record<string, number> = { ...prev };
      let changed = false;
      for (const col of columns) {
        const minWidth = col.minWidth ?? DEFAULT_MIN_WIDTH;
        const defaultWidth = col.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
        const existing = prev[col.id];
        const desired = existing !== undefined ? Math.max(minWidth, existing) : defaultWidth;
        if (desired !== next[col.id]) {
          next[col.id] = desired;
          changed = true;
        }
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
