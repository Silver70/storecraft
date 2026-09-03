import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * One header treatment for every analytics chart card — icon, title, optional
 * description, optional trailing action (a "View more" drill-in, a filter).
 * Having a single shell is what makes the page read as one system rather than a
 * pile of individually-styled cards.
 */
export function ChartCard({
  title,
  description,
  icon: Icon,
  action,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              {Icon ? (
                <Icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">{title}</span>
            </CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-xs">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn("pt-2", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

/** Shared empty state — an invitation to act, never an apology or a stack trace. */
export function EmptyState({
  message,
  detail,
}: {
  message: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {detail ? (
        <p className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground/70">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
