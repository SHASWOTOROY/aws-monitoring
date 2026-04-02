/** Preset ranges aligned with AWS console-style selectors */
export const RANGE_IDS = ["1h", "3h", "12h", "1d", "3d", "1w", "1m"];

/** CloudWatch GetMetricData caps datapoints per metric (use a safe margin). */
const MAX_DATAPOINTS_PER_METRIC = 1440;

/**
 * Periods (seconds) allowed in our UI / API — must be valid for GetMetricData.
 * Order: fine → coarse.
 */
const STANDARD_PERIODS = [60, 300, 3600, 21600, 86400];

/**
 * @param {string} rangeId
 * @returns {{ start: Date; end: Date }}
 */
export function resolveRange(rangeId) {
  const end = new Date();
  const start = new Date(end);

  const map = {
    "1h": 60 * 60 * 1000,
    "3h": 3 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
  };

  const ms = map[rangeId] ?? map["1w"];
  start.setTime(end.getTime() - ms);
  return { start, end };
}

/**
 * @param {number} durationSec
 * @param {number} periodSec
 */
function datapointCount(durationSec, periodSec) {
  return durationSec / periodSec;
}

/**
 * Smallest standard period so CloudWatch does not reject the query
 * (too many datapoints for the time window).
 * @param {number} durationSec
 */
function minPeriodForWindow(durationSec) {
  const minP = Math.ceil(durationSec / MAX_DATAPOINTS_PER_METRIC);
  for (const p of STANDARD_PERIODS) {
    if (p >= minP && datapointCount(durationSec, p) <= MAX_DATAPOINTS_PER_METRIC) {
      return p;
    }
  }
  return STANDARD_PERIODS[STANDARD_PERIODS.length - 1];
}

/**
 * CloudWatch period (seconds) — must fit the window (≤1440 datapoints per metric).
 * @param {string} rangeId
 * @param {number | undefined} requestedPeriod
 * @param {Date} start
 * @param {Date} end
 */
/**
 * Pick a preset key whose default period is appropriate for window length.
 * @param {number} durationSec
 */
export function periodDefaultKeyForDuration(durationSec) {
  if (durationSec <= 3600) return "1h";
  if (durationSec <= 3 * 3600) return "3h";
  if (durationSec <= 12 * 3600) return "12h";
  if (durationSec <= 86400) return "1d";
  if (durationSec <= 3 * 86400) return "3d";
  if (durationSec <= 7 * 86400) return "1w";
  return "1m";
}

/**
 * Absolute window from query (optional). Otherwise preset `range`.
 * @param {Record<string, unknown>} query
 * @returns {{ start: Date; end: Date; rangeLabel: string; periodRangeKey: string }}
 */
export function resolveTimeWindowFromQuery(query) {
  const range =
    typeof query.range === "string" ? query.range : "1w";
  const startStr =
    typeof query.start === "string" ? query.start.trim() : "";
  const endStr = typeof query.end === "string" ? query.end.trim() : "";

  if (startStr && endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      end.getTime() > start.getTime()
    ) {
      const maxMs = 400 * 24 * 60 * 60 * 1000;
      const span = end.getTime() - start.getTime();
      if (span <= maxMs) {
        const durationSec = span / 1000;
        return {
          start,
          end,
          rangeLabel: "custom",
          periodRangeKey: periodDefaultKeyForDuration(durationSec),
        };
      }
    }
  }

  const rangeId = RANGE_IDS.includes(range) ? range : "1w";
  const r = resolveRange(rangeId);
  return {
    start: r.start,
    end: r.end,
    rangeLabel: rangeId,
    periodRangeKey: rangeId,
  };
}

export function resolvePeriodSeconds(rangeId, requestedPeriod, start, end) {
  const durationSec = Math.max(
    1,
    (end.getTime() - start.getTime()) / 1000
  );

  const defaults = {
    "1h": 60,
    "3h": 60,
    "12h": 300,
    "1d": 300,
    "3d": 300,
    "1w": 3600,
    "1m": 3600,
  };

  let period = defaults[rangeId] ?? 300;

  if (
    requestedPeriod &&
    Number.isFinite(requestedPeriod) &&
    STANDARD_PERIODS.includes(requestedPeriod)
  ) {
    period = requestedPeriod;
  }

  if (datapointCount(durationSec, period) <= MAX_DATAPOINTS_PER_METRIC) {
    return period;
  }

  return minPeriodForWindow(durationSec);
}
