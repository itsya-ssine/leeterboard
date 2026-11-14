import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, useTheme } from "../../../theme.js";
import DifficultyBar from "../../../components/ui/DifficultyBar.js";

interface TrendPoint {
  date: string;
  solved: number;
  activeUsers: number;
}

const shortDate = (isoDate: string) =>
  new Date(isoDate).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  });

export default function GroupGrowthChart({
  trend,
  description = "Problems the whole roster has solved since tracking began",
  breakdownLabel = "Solved by difficulty, whole roster"
}: {
  trend: any;
  description?: string;
  breakdownLabel?: string;
}) {
  const series: TrendPoint[] = trend?.historyTrend ?? [];
  const breakdown: { name: string; value: number }[] = trend?.difficultyBreakdown ?? [];
  const pick = (name: string) => breakdown.find((b) => b.name === name)?.value ?? 0;
  const { theme } = useTheme();
  const c = chartColors(theme);
  const latest = series.length ? series[series.length - 1].solved : 0;
  const weekAgo = series.length > 7 ? series[series.length - 8].solved : (series[0]?.solved ?? 0);
  const weekDelta = Math.max(0, latest - weekAgo);

  return (
    <section
      id="growth-panel"
      aria-label="Group growth"
      className="card-aurora mb-8 animate-rise p-5"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// growth.log</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-strong">Group growth</h2>
          <p className="mt-0.5 text-sm text-mist-500">{description}</p>
        </div>
        {series.length >= 2 && (
          <div className="flex gap-2 font-mono">
            <div className="rounded-lg bg-tint px-3 py-1.5 ring-1 ring-line">
              <div className="text-[10px] uppercase tracking-widest text-mist-500">Since start</div>
              <div className="text-lg font-bold tabular-nums text-emerald-400">+{latest.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-tint px-3 py-1.5 ring-1 ring-line">
              <div className="text-[10px] uppercase tracking-widest text-mist-500">Last 7 days</div>
              <div className="text-lg font-bold tabular-nums text-teal-300">+{weekDelta.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      {series.length < 2 ? (
        <p className="py-10 text-center text-sm text-mist-500">
          The chart appears once the board has more than one day of history.
        </p>
      ) : (
        <div className="h-56 w-full">
          {/* Accessible data table for screen readers (WCAG 2.2 AA / UX-02) */}
          <div className="sr-only">
            <table>
              <caption>Group growth history</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Problems solved</th>
                </tr>
              </thead>
              <tbody>
                {series.map((pt) => (
                  <tr key={pt.date}>
                    <td>{shortDate(pt.date)}</td>
                    <td>{pt.solved.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="growthStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2dd4bf" />
                  <stop offset="55%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: c.tick, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[0, (max: number) => Math.max(5, Math.ceil(max * 1.1))]}
                allowDecimals={false}
                tickFormatter={(v: number) => v.toLocaleString()}
                tick={{ fill: c.tick, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: c.cursor }}
                contentStyle={{
                  background: c.tooltipBg,
                  border: `1px solid ${c.tooltipBorder}`,
                  borderRadius: 8,
                  color: c.tooltipText,
                  fontSize: 13
                }}
                labelStyle={{ color: c.tooltipLabel }}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value) => [`+${Number(value).toLocaleString()}`, "Growth"]}
              />
              <Area
                type="monotone"
                dataKey="solved"
                stroke="url(#growthStroke)"
                strokeWidth={3}
                fill="url(#growthFill)"
                isAnimationActive={true}
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {breakdown.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-widest text-mist-500">// {breakdownLabel}</div>
          <DifficultyBar easy={pick("Easy")} medium={pick("Medium")} hard={pick("Hard")} size="lg" />
        </div>
      )}
    </section>
  );
}
