import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  iconSize?: number;
  className?: string;
}

export function CopyButton({ value, iconSize = 14, className }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
        className,
      )}
      aria-label="Copy"
    >
      {copied ? (
        <Check style={{ width: iconSize, height: iconSize }} className="text-emerald-400" />
      ) : (
        <Copy style={{ width: iconSize, height: iconSize }} />
      )}
    </button>
  );
}
