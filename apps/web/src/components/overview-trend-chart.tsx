"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TrendPoint {
  date: string;
  label: string;
  leads: number;
  visits: number;
  bookings: number;
}

export function OverviewTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-[290px] w-full" role="img" aria-label="Daily leads, visits and bookings over the last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, left: -26, bottom: 0 }}>
          <defs>
            <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="4%" stopColor="#168f67" stopOpacity={0.32} />
              <stop offset="96%" stopColor="#168f67" stopOpacity={0.015} />
            </linearGradient>
            <linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="4%" stopColor="#d99d2a" stopOpacity={0.22} />
              <stop offset="96%" stopColor="#d99d2a" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="currentColor" className="text-border" vertical={false} strokeDasharray="4 4" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            minTickGap={32}
            tick={{ fill: "currentColor", fontSize: 11 }}
            className="text-muted-foreground"
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            className="text-muted-foreground"
          />
          <Tooltip
            cursor={{ stroke: "#8a9a94", strokeDasharray: "4 4" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid color-mix(in oklab, currentColor 15%, transparent)",
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              boxShadow: "0 18px 45px rgba(15, 23, 42, .12)",
              fontSize: 12,
            }}
            labelStyle={{ fontWeight: 700, marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke="#168f67"
            strokeWidth={2.4}
            fill="url(#leadsFill)"
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="visits"
            name="Completed visits"
            stroke="#d99d2a"
            strokeWidth={2}
            fill="url(#visitsFill)"
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="bookings"
            name="Bookings"
            stroke="#4679d8"
            strokeWidth={2}
            fill="transparent"
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
