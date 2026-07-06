import * as React from "react";
import { cn } from "@/lib/utils";

interface TableRowIconProps {
  icon: React.ReactNode;
  className?: string;
}

export function TableRowIcon({ icon, className }: TableRowIconProps) {
  return (
    <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground", className)}>
      {icon}
    </span>
  );
}
