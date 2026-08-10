"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashMovementPoint } from "@/lib/commercial-queries";
import { formatINR } from "@/lib/format";

/**
 * Cash in above the line, cash out below it.
 *
 * Refunds are plotted as negatives rather than as another upward bar, so a
 * period that gave money back is visibly a hole rather than a shorter column —
 * the shape of the chart tells you the direction before you read a single
 * number. The net line crosses zero exactly when a period returned more than it
 * took, which is the one moment worth noticing on this screen.
 */
export function CashMovementChart({ data }: { data: CashMovementPoint[] }) {
  const plotted = data.map((point) => ({
    ...point,
    // Mirrored for the axis; the tooltip reads the original positive figure.
    refundedPlot: -point.refunded,
  }));
  const hasRefunds = data.some((point) => point.refunded > 0);

  return (
    <div
      className="h-[300px] w-full"
      role="img"
      aria-label="Collections against refunds across the reporting period"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={plotted} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={(value: number) => formatINR(value, true)}
          />
          <ReferenceLine y={0} stroke="currentColor" className="text-zinc-400" />
          <Tooltip
            formatter={(value, name) => [
              // Refunds are plotted negative; the reader wants the magnitude.
              formatINR(Math.abs(Number(value ?? 0)), true),
              name === "refundedPlot" ? "Refunded" : name === "collected" ? "Collected" : "Net",
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(name) =>
              name === "refundedPlot" ? "Refunded" : name === "collected" ? "Collected" : "Net"
            }
          />
          <Bar dataKey="collected" fill="#168f67" radius={[3, 3, 0, 0]} maxBarSize={38} />
          {hasRefunds && (
            <Bar dataKey="refundedPlot" fill="#dc2626" radius={[0, 0, 3, 3]} maxBarSize={38} />
          )}
          <Line
            type="monotone"
            dataKey="net"
            stroke="#4679d8"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
