import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, useTheme } from "../../../theme.js";
import DifficultyBar from "../../../components/ui/DifficultyBar.js";
import { PixelFlame } from "../../../pixelArt.js";

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
      className="pixel-card mb-8 animate-rise p-5 sm:p-6 overflow-hidden"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink-800 pb-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2 font-mono text-xs text-mist-500">
            <span className="font-pixel text-[10px] text-emerald-400 font-bold">&gt;</span>
            <span>stats.growth_matrix</span>
          </div>
          <h2 className="font-pixel text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <PixelFlame size={16} />
            Group growth
          </h2>
          <p className="mt-1 font-mono text-xs text-mist-400">{description}</p>
        </div>
        {series.length >= 2 && (
          <div className="flex gap-2.5">
            <div className="border-2 border-ink-700 bg-ink-950 px-3.5 py-2 shadow-[2px_2px_0_#000]">
              <div className="font-pixel text-[9px] uppercase tracking-widest text-mist-500">Since start</div>
              <div className="font-pixel text-sm sm:text-base font-bold tabular-nums text-emerald-400">+{latest.toLocaleString()}</div>
            </div>
            <div className="border-2 border-ink-700 bg-ink-950 px-3.5 py-2 shadow-[2px_2px_0_#000]">
              <div className="font-pixel text-[9px] uppercase tracking-widest text-mist-500">Last 7 days</div>
              <div className="font-pixel text-sm sm:text-base font-bold tabular-nums text-teal-300">+{weekDelta.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      {series.length < 2 ? (
        <div className="py-12 text-center border-2 border-dashed border-ink-800 bg-ink-950/60 p-6">
          <p className="font-pixel text-xs text-mist-400">
            The chart appears once the board has more than one day of history.
          </p>
        </div>
      ) : (
        <div className="h-60 w-full pt-2">
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
            <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="growthStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="50%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={{ stroke: "#334155" }}
                minTickGap={32}
              />
              <YAxis
                domain={[0, (max: number) => Math.max(5, Math.ceil(max * 1.1))]}
                allowDecimals={false}
                tickFormatter={(v: number) => v.toLocaleString()}
                tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: "#34d399", strokeDasharray: "2 2" }}
                contentStyle={{
                  background: "#05080f",
                  border: "2px solid #273549",
                  boxShadow: "3px 3px 0 0 rgba(0,0,0,0.8)",
                  borderRadius: 0,
                  color: "#f8fafc",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)"
                }}
                labelStyle={{ color: "#34d399", fontFamily: "var(--font-pixel)", fontSize: 10 }}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value) => [`+${Number(value).toLocaleString()}`, "Growth"]}
              />
              <Area
                type="linear"
                dataKey="solved"
                stroke="url(#growthStroke)"
                strokeWidth={2.5}
                fill="url(#growthFill)"
                isAnimationActive={true}
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {breakdown.length > 0 && (
        <div className="mt-6 border-t-2 border-ink-800 pt-5">
          <div className="mb-3 flex items-center gap-2 font-pixel text-[10px] uppercase tracking-wider text-emerald-400">
            <span className="inline-block size-1.5 bg-emerald-400 shadow-[0_0_4px_#34d399]" />
            {breakdownLabel}
          </div>
          <DifficultyBar easy={pick("Easy")} medium={pick("Medium")} hard={pick("Hard")} size="lg" />
        </div>
      )}
    </section>
  );
}
