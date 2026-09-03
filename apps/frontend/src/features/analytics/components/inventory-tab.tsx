import { useSuspenseQuery } from "@tanstack/react-query";
import {
  BoxesIcon,
  AlertTriangleIcon,
  XCircleIcon,
  DollarSignIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { InventoryAnalytics } from "~/types/api";
import { inventoryAnalyticsQueryOptions } from "../queries";
import { money, num } from "../utils";
import { MetricTile } from "./metric-tile";

export function InventoryTab() {
  const data: InventoryAnalytics = useSuspenseQuery(
    inventoryAnalyticsQueryOptions(),
  ).data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Out of stock"
          value={num(data.outOfStockCount)}
          icon={XCircleIcon}
          status={data.outOfStockCount > 0 ? "critical" : undefined}
          hint="Variants at or below zero available"
        />
        <MetricTile
          label="Low stock"
          value={num(data.lowStockCount)}
          icon={AlertTriangleIcon}
          status={data.lowStockCount > 0 ? "warning" : undefined}
          hint="At or below threshold"
        />
        <MetricTile
          label="Stock on hand"
          value={num(data.stockUnits)}
          icon={BoxesIcon}
          hint={`${num(data.inStockCount)} variants in stock`}
        />
        <MetricTile
          label="Stock value"
          value={money(data.stockValueAtCost)}
          icon={DollarSignIcon}
          hint="At cost price"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Lowest stock
          </CardTitle>
          <CardDescription className="text-xs">
            Variants needing attention first
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {data.lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Everything is above its low-stock threshold
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="pl-6 text-xs font-medium">
                    Product
                  </TableHead>
                  <TableHead className="text-xs font-medium">SKU</TableHead>
                  <TableHead className="text-xs font-medium text-right">
                    Available
                  </TableHead>
                  <TableHead className="text-xs font-medium text-right pr-6">
                    Threshold
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lowStock.map((item) => (
                  <TableRow key={item.sku}>
                    <TableCell className="pl-6">
                      <p className="text-sm font-medium leading-none">
                        {item.productName}
                      </p>
                      {item.variantName ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.variantName}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {item.sku}
                    </TableCell>
                    <TableCell
                      className={`text-right text-sm font-semibold tabular-nums ${
                        item.available <= 0
                          ? "text-destructive"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {item.available}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums pr-6">
                      {item.threshold}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
