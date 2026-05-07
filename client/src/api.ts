import type { DashboardResponse } from "./types";

function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "";
  return b;
}

export async function fetchConfigStatus(): Promise<{
  configured: boolean;
  region: string;
}> {
  const res = await fetch(`${apiBase()}/api/config/status`, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function postAwsConfig(params: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ ok: boolean; account?: string; arn?: string }> {
  const res = await fetch(`${apiBase()}/api/config/aws`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.error === "string" ? err.error : `HTTP ${res.status}`
    );
  }
  return res.json();
}

export async function clearAwsConfig(): Promise<void> {
  const res = await fetch(`${apiBase()}/api/config/clear`, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.error === "string" ? err.error : `HTTP ${res.status}`
    );
  }
}

export async function downloadReportPdf(params: {
  range: string;
  statistic: string;
  period?: number;
  start?: string;
  end?: string;
  /** When non-empty, the PDF includes only these instances (must match monitored EC2). */
  instanceIds?: string[];
}): Promise<Blob> {
  const q = new URLSearchParams();
  q.set("range", params.range);
  q.set("statistic", params.statistic);
  if (params.period != null) q.set("period", String(params.period));
  if (params.start) q.set("start", params.start);
  if (params.end) q.set("end", params.end);
  for (const id of params.instanceIds ?? []) {
    const s = id.trim();
    if (s) q.append("instanceId", s);
  }

  const res = await fetch(`${apiBase()}/api/report/pdf?${q.toString()}`, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!res.ok) {
    const raw = await res.text();
    const text = raw.trim();
    let message = text;
    if (text.length > 0 && (text.startsWith("{") || text.startsWith("["))) {
      try {
        const j = JSON.parse(text) as { error?: string };
        message =
          typeof j.error === "string" ? j.error : text || `HTTP ${res.status}`;
      } catch {
        message = text || `Report failed (HTTP ${res.status})`;
      }
    } else if (!text) {
      message = `Report failed (empty response, HTTP ${res.status}). Try again or check the API / proxy.`;
    }
    throw new Error(message);
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const raw = await res.text();
    const text = raw.trim();
    let message = "Server returned JSON instead of a PDF.";
    if (text) {
      try {
        const j = JSON.parse(text) as { error?: string };
        message = typeof j.error === "string" ? j.error : text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }

  return res.blob();
}

export async function fetchDashboard(params: {
  range: string;
  period?: number;
  statistic?: string;
  start?: string;
  end?: string;
}): Promise<DashboardResponse> {
  const q = new URLSearchParams();
  q.set("range", params.range);
  if (params.period != null) q.set("period", String(params.period));
  if (params.statistic) q.set("statistic", params.statistic);
  if (params.start) q.set("start", params.start);
  if (params.end) q.set("end", params.end);

  const url = `${apiBase()}/api/dashboard?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.error === "string" ? err.error : `HTTP ${res.status}`
    );
  }
  return res.json();
}
