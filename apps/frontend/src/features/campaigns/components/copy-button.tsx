import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Copies a value in one action.
 *
 * Everything this campaign screen hands to an ad platform — the canonical tag,
 * the generated link — is only correct if it arrives there unretyped, so
 * copying is a single click and confirms itself.
 *
 * With `children` it renders as a labelled button; without, as an icon.
 */
export function CopyButton({
  value,
  label,
  children,
  variant = "ghost",
  className,
  disabled,
}: {
  value: string;
  /** What is being copied, for the screen reader: "Copy link". */
  label: string;
  children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const icon = copied ? (
    <CheckIcon className="h-3.5 w-3.5" />
  ) : (
    <CopyIcon className="h-3.5 w-3.5" />
  );

  return (
    <Button
      type="button"
      variant={variant}
      size={children ? "sm" : "icon"}
      disabled={disabled}
      className={cn(
        "shrink-0",
        !children && "h-7 w-7 text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {icon}
      {children ? <span>{copied ? "Copied" : children}</span> : null}
    </Button>
  );
}
