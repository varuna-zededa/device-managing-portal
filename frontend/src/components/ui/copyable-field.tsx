import * as React from "react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";

export const CopyableField = memo(({ label, value, mono = false, link, linkTo, onLinkClick, children }: {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
  linkTo?: string;
  onLinkClick?: () => void;
  children?: React.ReactNode;
}) => (
  <div className="group flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2 justify-end min-w-0">
      {value && value !== "—" && (
        <CopyButton
          value={value}
          iconSize={12}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
      {children ? children : linkTo ? (
        <a href={linkTo} className="text-sm font-medium text-primary hover:underline break-all text-right">
          {value}
        </a>
      ) : link && onLinkClick ? (
        <button className="text-sm font-medium text-primary hover:underline break-all text-right" onClick={onLinkClick}>
          {value}
        </button>
      ) : (
        <span className={cn("text-sm break-all text-right", mono ? "font-mono text-xs text-foreground" : "font-medium text-foreground")}>
          {value || "—"}
        </span>
      )}
    </div>
  </div>
));
CopyableField.displayName = "CopyableField";

export const CopyableValue = memo(({ value, mono, className }: {
  value: string;
  mono?: boolean;
  className?: string;
}) => {
  if (!value) return <span className="text-sm text-muted-foreground">Not Configured</span>;
  return (
    <span className={cn("group/field inline-flex items-center gap-1.5", mono && "font-mono", className)}>
      <CopyButton
        value={value}
        iconSize={12}
        className="opacity-0 group-hover/field:opacity-100 transition-opacity"
      />
      <span className="text-sm text-foreground">{value}</span>
    </span>
  );
});
CopyableValue.displayName = "CopyableValue";
