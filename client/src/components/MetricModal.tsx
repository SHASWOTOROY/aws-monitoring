import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Datapoint } from "../types";

type Props = {
  title: string;
  subtitle: string;
  unitLabel: string;
  series: Datapoint[];
  color?: string;
  onClose: () => void;
};

function formatTick(ts: string) {
  const d = new Date(ts);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const CHART_PX = 320;

export function MetricModal({
  title,
  subtitle,
  unitLabel,
  series,
  color = "#0972d3",
  onClose,
}: Props) {
  const data = series.map((p) => ({
    t: p.timestamp,
    v: p.value,
  }));

  const hasNumericPoints = useMemo(
    () =>
      series.some(
        (p) => p.value != null && Number.isFinite(Number(p.value))
      ),
    [series]
  );

  const yMax = useMemo(() => {
    let m = 0;
    for (const p of series) {
      if (p.value != null && !Number.isNaN(p.value)) {
        m = Math.max(m, p.value);
      }
    }
    return Math.min(100, Math.max(4, Math.ceil(m * 1.12)));
  }, [series]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2 id="metric-modal-title">{title}</h2>
            <div className="muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-chart">
            {!hasNumericPoints ? (
              <div
                className="modal-chart-empty"
                style={{
                  height: CHART_PX,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 16px",
                  textAlign: "center",
                  color: "var(--aws-muted)",
                  fontSize: "0.875rem",
                  border: "1px dashed var(--aws-border)",
                  borderRadius: 4,
                  background: "var(--aws-bg)",
                }}
              >
                No data points in this range. Try a shorter time range or confirm
                CloudWatch has metrics for this instance.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={CHART_PX}>
                <LineChart
                  data={data}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e9ebed"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    type="category"
                    tickFormatter={(v) => formatTick(String(v))}
                    minTickGap={32}
                    tick={{ fontSize: 11, fill: "#545b64" }}
                    stroke="#d5dbdb"
                  />
                  <YAxis
                    domain={[0, yMax]}
                    tickFormatter={(v) => `${v}%`}
                    width={48}
                    tick={{ fontSize: 11, fill: "#545b64" }}
                    stroke="#d5dbdb"
                    label={{
                      value: unitLabel,
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#545b64", fontSize: 11 },
                    }}
                  />
                  <Tooltip
                    labelFormatter={(v) => formatTick(String(v))}
                    formatter={(value) => {
                      const n =
                        typeof value === "number"
                          ? value
                          : typeof value === "string"
                            ? Number(value)
                            : NaN;
                      const text =
                        Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
                      return [text, title];
                    }}
                    contentStyle={{
                      border: "1px solid #d5dbdb",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <div className="legend-line">
            <span className="legend-swatch" style={{ background: color }} />
            <span>{title}</span>
          </div>
          <div className="footer-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
