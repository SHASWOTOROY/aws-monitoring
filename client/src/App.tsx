import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchDashboard,
  fetchConfigStatus,
  downloadReportPdf,
  clearAwsConfig,
} from "./api";
import type { DashboardResponse, InstanceRow } from "./types";
import { BrandHeader } from "./components/BrandHeader";
import { MetricModal } from "./components/MetricModal";
import { SetupWizard } from "./components/SetupWizard";

const RANGES = ["1h", "3h", "12h", "1d", "3d", "1w", "1m", "custom"] as const;
const STATS = ["Average", "Maximum", "Minimum"] as const;
type CustomUnit = "minutes" | "hours" | "days" | "weeks" | "months";

function relativeWindowMs(value: number, unit: CustomUnit): number {
  const v = Math.max(1, Math.min(9999, Math.floor(Number(value)) || 1));
  switch (unit) {
    case "minutes":
      return v * 60_000;
    case "hours":
      return v * 60 * 60_000;
    case "days":
      return v * 24 * 60 * 60_000;
    case "weeks":
      return v * 7 * 24 * 60 * 60_000;
    case "months":
      return v * 30 * 24 * 60 * 60_000;
    default:
      return v * 60 * 60_000;
  }
}

function customWindowIsoBounds(rel: { value: number; unit: CustomUnit }) {
  const end = new Date();
  const start = new Date(end.getTime() - relativeWindowMs(rel.value, rel.unit));
  return { start: start.toISOString(), end: end.toISOString() };
}
const PERIODS = [
  { label: "1 minute", value: 60 },
  { label: "5 minutes", value: 300 },
  { label: "1 hour", value: 3600 },
] as const;

function lastCpu(series: { value: number | null }[] | undefined): string {
  if (!series?.length) return "—";
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]?.value;
    if (v != null && !Number.isNaN(v)) return `${v.toFixed(1)}%`;
  }
  return "—";
}

function lastMem(
  available: boolean,
  series: { value: number | null }[] | undefined
): string {
  if (!available || !series?.length) return "—";
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]?.value;
    if (v != null && !Number.isNaN(v)) return `${v.toFixed(1)}%`;
  }
  return "—";
}

type AwsPhase = "checking" | "setup" | "ok";

export default function App() {
  const [awsPhase, setAwsPhase] = useState<AwsPhase>("checking");
  const [range, setRange] = useState<(typeof RANGES)[number]>("1w");
  const [statistic, setStatistic] = useState<(typeof STATS)[number]>("Average");
  const [periodOverride, setPeriodOverride] = useState<number | null>(null);
  const [customRel, setCustomRel] = useState<{ value: number; unit: CustomUnit }>(
    { value: 1, unit: "months" }
  );
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [instanceSearch, setInstanceSearch] = useState("");
  /** Instance IDs to include in the PDF (subset of monitored instances). */
  const [pdfSelectedIds, setPdfSelectedIds] = useState<string[]>([]);
  const pdfHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  const [modal, setModal] = useState<{
    instance: InstanceRow;
    metric: "cpu" | "memory";
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchConfigStatus();
        setAwsPhase(s.configured ? "ok" : "setup");
      } catch {
        setAwsPhase("setup");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (awsPhase !== "ok") return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDashboard({
        range,
        statistic,
        period: periodOverride ?? undefined,
        ...(range === "custom" ? customWindowIsoBounds(customRel) : {}),
      });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, statistic, periodOverride, customRel, awsPhase]);

  useEffect(() => {
    if (awsPhase === "ok") void load();
  }, [load, awsPhase]);

  const periodLabel = useMemo(() => {
    const sec = data?.periodSeconds ?? 300;
    const hit = PERIODS.find((p) => p.value === sec);
    return hit?.label ?? `${sec}s`;
  }, [data?.periodSeconds]);

  const filteredInstances = useMemo(() => {
    if (!data?.instances.length) return [];
    const q = instanceSearch.trim().toLowerCase();
    if (!q) return data.instances;
    return data.instances.filter((i) => i.name.toLowerCase().includes(q));
  }, [data?.instances, instanceSearch]);

  const monitoredIdsKey = useMemo(
    () =>
      data?.instances?.length
        ? data.instances.map((i) => i.instanceId).join("\0")
        : "",
    [data?.instances]
  );

  useEffect(() => {
    if (!data?.instances?.length) {
      setPdfSelectedIds([]);
      return;
    }
    setPdfSelectedIds((prev) => {
      const allowed = new Set(data.instances.map((i) => i.instanceId));
      const kept = prev.filter((id) => allowed.has(id));
      if (kept.length > 0) return kept;
      return data.instances.map((i) => i.instanceId);
    });
  }, [monitoredIdsKey]);

  const pdfAllFilteredSelected = useMemo(
    () =>
      filteredInstances.length > 0 &&
      filteredInstances.every((i) =>
        pdfSelectedIds.includes(i.instanceId)
      ),
    [filteredInstances, pdfSelectedIds]
  );

  const pdfSomeFilteredSelected = useMemo(
    () =>
      filteredInstances.some((i) => pdfSelectedIds.includes(i.instanceId)),
    [filteredInstances, pdfSelectedIds]
  );

  useEffect(() => {
    const el = pdfHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      pdfSomeFilteredSelected && !pdfAllFilteredSelected;
  }, [pdfSomeFilteredSelected, pdfAllFilteredSelected]);

  function togglePdfInstance(instanceId: string) {
    if (!data?.instances?.length) return;
    setPdfSelectedIds((prev) => {
      const sel = new Set(prev);
      if (sel.has(instanceId)) sel.delete(instanceId);
      else sel.add(instanceId);
      return data.instances
        .map((i) => i.instanceId)
        .filter((id) => sel.has(id));
    });
  }

  function togglePdfAllFiltered() {
    if (!data?.instances?.length || filteredInstances.length === 0) return;
    setPdfSelectedIds((prev) => {
      const sel = new Set(prev);
      const ids = filteredInstances.map((i) => i.instanceId);
      const allOn = ids.every((id) => sel.has(id));
      if (allOn) ids.forEach((id) => sel.delete(id));
      else ids.forEach((id) => sel.add(id));
      return data!.instances
        .map((i) => i.instanceId)
        .filter((id) => sel.has(id));
    });
  }

  async function onGenerateReport() {
    if (pdfSelectedIds.length === 0 || !data?.instances?.length) return;
    setReportBusy(true);
    setError(null);
    try {
      const blob = await downloadReportPdf({
        range,
        statistic,
        period: periodOverride ?? undefined,
        ...(range === "custom" ? customWindowIsoBounds(customRel) : {}),
        instanceIds: pdfSelectedIds,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const n = pdfSelectedIds.length;
      const safe =
        n === 1
          ? (
              data.instances.find((i) => i.instanceId === pdfSelectedIds[0])
                ?.name ?? pdfSelectedIds[0]
            )
              .replace(/[^\w.-]+/g, "_")
              .slice(0, 80)
          : `${n}-instances`;
      a.download = `ec2-utilization-${safe}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      await clearAwsConfig();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed");
      setReportBusy(false);
    }
  }

  async function onDisconnect() {
    setError(null);
    try {
      await clearAwsConfig();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    }
  }

  if (awsPhase === "checking") {
    return (
      <div className="page">
        <BrandHeader />
        <div className="app-shell">
          <div className="loading">Checking AWS configuration…</div>
        </div>
      </div>
    );
  }

  if (awsPhase === "setup") {
    return (
      <div className="page">
        <BrandHeader />
        <div className="app-shell">
          <SetupWizard
            onConnected={() => {
              setAwsPhase("ok");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <BrandHeader />
      <div className="app-shell">
        <p className="app-sub app-sub-first">
          CPU from CloudWatch (<code>AWS/EC2</code> ·{" "}
          <code>CPUUtilization</code>
          ). Memory appears after the CloudWatch Agent publishes metrics.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="toolbar">
          <div className="toolbar-filters">
            <div className="toolbar-group">
              <span className="toolbar-label">Granularity</span>
              <select
                aria-label="Period"
                value={periodOverride ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setPeriodOverride(v === "" ? null : Number(v));
                }}
              >
                <option value="">Auto ({periodLabel})</option>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Statistic</span>
              <select
                aria-label="Statistic"
                value={statistic}
                onChange={(e) =>
                  setStatistic(e.target.value as (typeof STATS)[number])
                }
              >
                {STATS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="range-bts-wrap toolbar-group">
              <span className="toolbar-label">Range</span>
              <div className="range-btns">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={range === r ? "active" : ""}
                    onClick={() => setRange(r)}
                  >
                    {r === "custom" ? "Custom" : r}
                  </button>
                ))}
              </div>
            </div>
            {range === "custom" && (
              <div className="toolbar-group custom-range-row">
                <span className="toolbar-label">Window</span>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  className="custom-range-input"
                  aria-label="Custom range duration"
                  value={customRel.value}
                  onChange={(e) =>
                    setCustomRel((c) => ({
                      ...c,
                      value: Math.max(
                        1,
                        Math.min(9999, Number(e.target.value) || 1)
                      ),
                    }))
                  }
                />
                <select
                  aria-label="Custom range unit"
                  value={customRel.unit}
                  onChange={(e) =>
                    setCustomRel((c) => ({
                      ...c,
                      unit: e.target.value as CustomUnit,
                    }))
                  }
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </div>
            )}
            <div className="toolbar-group">
              <span className="toolbar-label">Search names</span>
              <input
                type="search"
                className="instance-search-input"
                placeholder="Filter table…"
                value={instanceSearch}
                onChange={(e) => setInstanceSearch(e.target.value)}
                disabled={!data?.instances?.length}
                aria-label="Filter instances by name"
              />
            </div>
            <div className="toolbar-group utc-hint">UTC timezone</div>
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="refresh-btn"
              onClick={() => void load()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                reportBusy ||
                pdfSelectedIds.length === 0 ||
                !data?.instances?.length
              }
              onClick={() => void onGenerateReport()}
            >
              {reportBusy ? "Building PDF…" : "Generate PDF report"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={reportBusy}
              onClick={() => void onDisconnect()}
            >
              Disconnect
            </button>
          </div>
        </div>

        {loading && !data && (
          <div className="loading">Loading metrics…</div>
        )}

        {data && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col" className="cell-pdf">
                    <div className="th-pdf-select">
                      <input
                        ref={pdfHeaderCheckboxRef}
                        type="checkbox"
                        checked={
                          pdfAllFilteredSelected &&
                          filteredInstances.length > 0
                        }
                        disabled={
                          !data.instances.length ||
                          filteredInstances.length === 0
                        }
                        onChange={() => togglePdfAllFiltered()}
                        aria-label="Select all visible instances for PDF report"
                      />
                      <span className="th-pdf-label">PDF</span>
                    </div>
                  </th>
                  <th>Name</th>
                  <th>Instance</th>
                  <th>CPU</th>
                  <th>Memory</th>
                </tr>
              </thead>
              <tbody>
                {data.instances.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No instances found in this region (or filter).
                    </td>
                  </tr>
                )}
                {data.instances.length > 0 &&
                  filteredInstances.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No instances match your search.
                      </td>
                    </tr>
                  )}
                {filteredInstances.map((inst) => {
                  const memLabel = lastMem(
                    data.memory.available,
                    data.memory.series[inst.instanceId]
                  );
                  const memHasValue = memLabel !== "—";
                  return (
                    <tr
                      key={inst.instanceId}
                      onClick={() =>
                        setModal({ instance: inst, metric: "cpu" })
                      }
                    >
                      <td
                        className="cell-pdf"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={pdfSelectedIds.includes(
                            inst.instanceId
                          )}
                          onChange={() =>
                            togglePdfInstance(inst.instanceId)
                          }
                          aria-label={`Include ${inst.name} in PDF report`}
                        />
                      </td>
                      <td>{inst.name}</td>
                      <td className="muted num">{inst.instanceId}</td>
                      <td className="num">
                        <button
                          type="button"
                          style={{
                            border: "none",
                            background: "none",
                            color: "var(--aws-blue)",
                            padding: 0,
                            textDecoration: "underline",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ instance: inst, metric: "cpu" });
                          }}
                        >
                          {lastCpu(data.cpu[inst.instanceId])}
                        </button>
                      </td>
                      <td
                        className="num"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={
                            memHasValue
                              ? `Memory ${memLabel}`
                              : "Memory — open chart or details"
                          }
                          style={{
                            border: "none",
                            background: "none",
                            color: memHasValue
                              ? "var(--aws-blue)"
                              : "var(--aws-muted)",
                            padding: 0,
                            textDecoration: memHasValue
                              ? "underline"
                              : "none",
                            cursor: "pointer",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ instance: inst, metric: "memory" });
                          }}
                        >
                          {memLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {modal && data && (
          <MetricModal
            key={`${modal.instance.instanceId}-${modal.metric}-${data.range}-${data.periodSeconds}-${data.statistic}`}
            title={
              modal.metric === "cpu"
                ? "CPU utilization (%)"
                : "Memory utilization (%)"
            }
            subtitle={`${modal.instance.instanceId} (${modal.instance.name}) · ${data.range} · ${periodLabel} · ${data.statistic}`}
            unitLabel="Percent"
            series={
              modal.metric === "cpu"
                ? data.cpu[modal.instance.instanceId] ?? []
                : data.memory.series[modal.instance.instanceId] ?? []
            }
            color={modal.metric === "cpu" ? "#0972d3" : "#1d8102"}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </div>
  );
}
