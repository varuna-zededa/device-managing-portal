import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedCellProps {
  children: React.ReactNode;
  tooltipContent?: React.ReactNode;
  className?: string;
  maxWidth?: number;
}

export function TruncatedCell({ children, tooltipContent, className, maxWidth }: TruncatedCellProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  const content = (
    <div
      ref={ref}
      className={cn("truncate", className)}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {children}
    </div>
  );

  if (!isTruncated) return content;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs break-words">
          {tooltipContent ?? children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
