"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VerificationTrendPoint } from "@/lib/accounts-queries";
import { formatINR, formatPercent } from "@/lib/format";

/**
 * Booked value split by whether accounts has stood behind it.
 *
 * Stacked rather than side-by-side because the two parts are the same money:
 * the column height is what the period sold, and the green portion is how much
 * of that a second pair of eyes has confirmed. Side-by-side bars would read as
 * two independent quantities and lose exactly the relationship worth seeing.
 *
 * The coverage line carries the point a stack cannot: a month that sold twice
 * as much and verified twice as much has not improved, and only a ratio says so.
 */
export function VerificationChart({ data }: { data: VerificationTrendPoint[] }) {
  const plotted = data.map((point) => {
    const total = point.validated + point.unvalidated;
    return { ...point, coverage: total > 0 ? (point.validated / total) * 100 : null };
  });
  const hasAny = plotted.some((point) => point.validated + point.unvalidated > 0);

  if (!hasAny) {
    return (
      <p className="px-5 py-12 text-center text-sm text-zinc-500">
        No booked value in this period to verify.
      </p>
    );
  }

  return (
    <div
      className="h-[300px] w-full"
      role="img"
      aria-label="Validated against unverified booking value across the reporting period"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={plotted} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            className="stroke-zinc-200 dark:stroke-zinc-800"
          />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            yAxisId="value"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={(value: number) => formatINR(value, true)}
          />
          <YAxis
            yAxisId="coverage"
            orientation="right"
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={40}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === "coverage") {
                return [
                  value == null ? "—" : formatPercent(Number(value) / 100, 0),
                  "Verified share",
                ];
              }
              return [
                formatINR(Number(value ?? 0), true),
                name === "validated" ? "Validated" : "Awaiting / no match",
              ];
            }}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(name) =>
              name === "validated"
                ? "Validated"
                : name === "unvalidated"
                  ? "Awaiting / no match"
                  : "Verified share"
            }
          />
          <Bar
            yAxisId="value"
            dataKey="validated"
            stackId="booked"
            fill="#168f67"
            maxBarSize={38}
          />
          <Bar
            yAxisId="value"
            dataKey="unvalidated"
            stackId="booked"
            fill="#d4d4d8"
            radius={[3, 3, 0, 0]}
            maxBarSize={38}
          />
          <Line
            yAxisId="coverage"
            type="monotone"
            dataKey="coverage"
            stroke="#4679d8"
            strokeWidth={2}
            dot={false}
            connectNulls
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
