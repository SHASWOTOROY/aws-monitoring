import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
} from "@aws-sdk/client-cloudwatch";
import { config, getAwsCredentials, getAwsRegion } from "../config.js";

let client;

/** CW Agent may use InstanceId, host (private DNS), or both; GetMetricData needs the exact dimension set. */
const memoryDimensionCache = new Map();
const MEMORY_DIM_CACHE_MS = 5 * 60 * 1000;
const LIST_METRICS_SCAN_MAX_PAGES = 100;

/**
 * @param {import("@aws-sdk/client-cloudwatch").Metric[]} metrics
 * @returns {Array<{ Name: string; Value: string }> | null}
 */
function pickBestDimensions(metrics) {
  if (!metrics.length) return null;
  metrics.sort(
    (a, b) => (b.Dimensions?.length ?? 0) - (a.Dimensions?.length ?? 0)
  );
  const d = metrics[0].Dimensions;
  return d?.length ? d : null;
}

/**
 * @param {string} instanceId
 * @param {string[]} hostCandidates EC2-derived + optional env extras (match CW Agent `host` dimension)
 * @returns {Promise<Array<{ Name: string; Value: string }>>}
 */
async function getMemoryMetricDimensions(instanceId, hostCandidates) {
  const now = Date.now();
  const hit = memoryDimensionCache.get(instanceId);
  if (hit && hit.expires > now) return hit.dims;

  const cw = getClient();
  const ns = config.memory.namespace;
  const mn = config.memory.metricName;
  const hosts = [...new Set(hostCandidates.filter(Boolean))];

  async function listWithFilter(dimensions) {
    /** @type {import("@aws-sdk/client-cloudwatch").Metric[]} */
    let collected = [];
    let NextToken;
    do {
      const resp = await cw.send(
        new ListMetricsCommand({
          Namespace: ns,
          MetricName: mn,
          Dimensions: dimensions,
          NextToken,
        })
      );
      collected = collected.concat(resp.Metrics ?? []);
      NextToken = resp.NextToken;
    } while (NextToken);
    return collected;
  }

  /** @type {import("@aws-sdk/client-cloudwatch").Metric[]} */
  let collected = [];
  try {
    collected = await listWithFilter([
      { Name: "InstanceId", Value: instanceId },
    ]);

    if (collected.length === 0) {
      for (const h of hosts) {
        collected = await listWithFilter([{ Name: "host", Value: h }]);
        if (collected.length > 0) break;
      }
    }

    if (collected.length === 0) {
      collected = await listAllMemoryMetricsForInstance(
        cw,
        instanceId,
        hosts
      );
    }
  } catch (e) {
    console.warn(
      "ListMetrics for memory (need cloudwatch:ListMetrics?):",
      e?.message ?? e
    );
    return [{ Name: "InstanceId", Value: instanceId }];
  }

  const dims = pickBestDimensions(collected);
  if (!dims) {
    return [{ Name: "InstanceId", Value: instanceId }];
  }

  memoryDimensionCache.set(instanceId, { dims, expires: now + MEMORY_DIM_CACHE_MS });
  return dims;
}

/**
 * Paginate ListMetrics (namespace + metric name only) and return every metric for this instance.
 * @param {import("@aws-sdk/client-cloudwatch").CloudWatchClient} cw
 */
async function listAllMemoryMetricsForInstance(cw, instanceId, hostCandidates) {
  const hostSet = new Set(hostCandidates.filter(Boolean));
  /** @type {import("@aws-sdk/client-cloudwatch").Metric[]} */
  const matches = [];
  let NextToken;

  for (let page = 0; page < LIST_METRICS_SCAN_MAX_PAGES; page++) {
    const resp = await cw.send(
      new ListMetricsCommand({
        Namespace: config.memory.namespace,
        MetricName: config.memory.metricName,
        NextToken,
      })
    );
    for (const m of resp.Metrics ?? []) {
      const dims = m.Dimensions ?? [];
      const byInstance = dims.some(
        (d) => d.Name === "InstanceId" && d.Value === instanceId
      );
      const byHost = dims.some(
        (d) =>
          d.Name === "host" &&
          !!d.Value &&
          hostSet.has(d.Value)
      );
      if (byInstance || byHost) matches.push(m);
    }
    NextToken = resp.NextToken;
    if (!NextToken) break;
  }

  return matches;
}

/**
 * @param {import("@aws-sdk/client-cloudwatch").Metric[]} metrics
 * @returns {Array<Array<{ Name: string; Value: string }>>}
 */
function uniqueSortedDimensionSets(metrics) {
  const seen = new Set();
  /** @type {Array<Array<{ Name: string; Value: string }>>} */
  const sets = [];
  for (const m of metrics) {
    const dims = m.Dimensions;
    if (!dims?.length) continue;
    const normalized = dims
      .filter((d) => d.Name && d.Value != null && String(d.Value).length > 0)
      .map((d) => ({ Name: d.Name, Value: String(d.Value) }));
    if (!normalized.length) continue;
    const key = normalized
      .map((d) => `${d.Name}\0${d.Value}`)
      .sort()
      .join("\n");
    if (seen.has(key)) continue;
    seen.add(key);
    sets.push(normalized);
  }
  sets.sort((a, b) => b.length - a.length);
  return sets;
}

/**
 * @returns {Promise<Array<{ timestamp: string; value: number | null }>>}
 */
async function fetchMemoryDatapoints(
  cw,
  dimensions,
  start,
  end,
  periodSeconds,
  stat
) {
  const resp = await cw.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: [
        {
          Id: "mem_fb",
          MetricStat: {
            Metric: {
              Namespace: config.memory.namespace,
              MetricName: config.memory.metricName,
              Dimensions: dimensions,
            },
            Period: periodSeconds,
            Stat: stat,
          },
          ReturnData: true,
        },
      ],
      ScanBy: "TimestampAscending",
    })
  );
  const r = resp.MetricDataResults?.[0];
  if (r?.Messages?.length) {
    console.warn("Memory fallback query:", r.Messages);
  }
  if (!r) return [];
  const ts = r.Timestamps ?? [];
  const vals = r.Values ?? [];
  const len = Math.min(ts.length, vals.length);
  /** @type {Array<{ timestamp: string; value: number | null }>} */
  const out = [];
  for (let j = 0; j < len; j++) {
    const t = ts[j];
    const v = vals[j];
    if (!t) continue;
    out.push({
      timestamp: t.toISOString(),
      value: v != null ? Number(v) : null,
    });
  }
  return out;
}

function seriesHasAnyPoint(series) {
  return (
    series.length > 0 &&
    series.some(
      (p) => p.value != null && Number.isFinite(Number(p.value))
    )
  );
}

function getClient() {
  if (!client) {
    client = new CloudWatchClient({
      region: getAwsRegion(),
      credentials: getAwsCredentials(),
    });
  }
  return client;
}

export function invalidateCloudWatchClient() {
  client = undefined;
  memoryDimensionCache.clear();
}

const STATISTICS = ["Average", "Maximum", "Minimum", "Sum", "SampleCount"];

function mergeResultInto(byId, instanceId, r) {
  const ts = r.Timestamps ?? [];
  const vals = r.Values ?? [];
  const len = Math.min(ts.length, vals.length);
  for (let j = 0; j < len; j++) {
    const t = ts[j];
    const v = vals[j];
    if (!t) continue;
    if (!byId[instanceId]) byId[instanceId] = [];
    byId[instanceId].push({
      timestamp: t.toISOString(),
      value: v != null ? Number(v) : null,
    });
  }
}

/**
 * @param {object} opts
 * @param {string[]} opts.instanceIds
 * @param {Date} opts.start
 * @param {Date} opts.end
 * @param {number} opts.periodSeconds
 * @param {string} opts.statistic
 * @returns {Promise<Record<string, Array<{ timestamp: string; value: number | null }>>>}
 */
export async function getCpuSeries({
  instanceIds,
  start,
  end,
  periodSeconds,
  statistic,
}) {
  const stat = STATISTICS.includes(statistic) ? statistic : "Average";
  const cw = getClient();
  /** @type {Record<string, Array<{ timestamp: string; value: number | null }>>} */
  const byId = Object.fromEntries(instanceIds.map((id) => [id, []]));

  const chunkSize = 100;
  for (let i = 0; i < instanceIds.length; i += chunkSize) {
    const chunk = instanceIds.slice(i, i + chunkSize);
    /** @type {Record<string, string>} */
    const idToInstance = {};
    const MetricDataQueries = chunk.map((instanceId, idx) => {
      const qid = `cpu_${i}_${idx}`;
      idToInstance[qid] = instanceId;
      return {
        Id: qid,
        MetricStat: {
          Metric: {
            Namespace: "AWS/EC2",
            MetricName: "CPUUtilization",
            Dimensions: [{ Name: "InstanceId", Value: instanceId }],
          },
          Period: periodSeconds,
          Stat: stat,
        },
        ReturnData: true,
      };
    });

    const resp = await cw.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries,
        ScanBy: "TimestampAscending",
      })
    );

    for (const r of resp.MetricDataResults ?? []) {
      const qid = r.Id;
      const instanceId = qid ? idToInstance[qid] : undefined;
      if (!instanceId) continue;
      mergeResultInto(byId, instanceId, r);
    }
  }

  for (const id of instanceIds) {
    byId[id].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  return byId;
}

/**
 * Memory requires CloudWatch Agent publishing to CWAgent (or custom namespace).
 * @param {Record<string, string[]>} [opts.instanceHostCandidatesById] per-instance `host` candidates (short DNS, ip-x-x-x-x, …)
 * @returns {Promise<{ available: boolean; series: Record<string, Array<{ timestamp: string; value: number | null }>> }>}
 */
export async function getMemorySeries({
  instanceIds,
  instanceHostCandidatesById = {},
  start,
  end,
  periodSeconds,
  statistic,
}) {
  const stat = STATISTICS.includes(statistic) ? statistic : "Average";
  const cw = getClient();
  /** @type {Record<string, Array<{ timestamp: string; value: number | null }>>} */
  const byId = Object.fromEntries(instanceIds.map((id) => [id, []]));

  const chunkSize = 100;
  for (let i = 0; i < instanceIds.length; i += chunkSize) {
    const chunk = instanceIds.slice(i, i + chunkSize);
    /** @type {Record<string, string>} */
    const idToInstance = {};
    const MetricDataQueries = await Promise.all(
      chunk.map(async (instanceId, idx) => {
        const qid = `mem_${i}_${idx}`;
        idToInstance[qid] = instanceId;
        const dimensions = await getMemoryMetricDimensions(
          instanceId,
          instanceHostCandidatesById[instanceId] ?? []
        );
        return {
          Id: qid,
          MetricStat: {
            Metric: {
              Namespace: config.memory.namespace,
              MetricName: config.memory.metricName,
              Dimensions: dimensions,
            },
            Period: periodSeconds,
            Stat: stat,
          },
          ReturnData: true,
        };
      })
    );

    try {
      const resp = await cw.send(
        new GetMetricDataCommand({
          StartTime: start,
          EndTime: end,
          MetricDataQueries,
          ScanBy: "TimestampAscending",
        })
      );

      for (const r of resp.MetricDataResults ?? []) {
        const qid = r.Id;
        const instanceId = qid ? idToInstance[qid] : undefined;
        if (!instanceId) continue;
        if (r.Messages?.length) {
          console.warn("Memory metric result:", qid, r.Messages);
        }
        mergeResultInto(byId, instanceId, r);
      }
    } catch (e) {
      console.warn("GetMetricData memory:", e?.message ?? e);
      return { available: false, series: {} };
    }
  }

  for (const instanceId of instanceIds) {
    if (seriesHasAnyPoint(byId[instanceId] ?? [])) continue;

    memoryDimensionCache.delete(instanceId);
    const hosts = instanceHostCandidatesById[instanceId] ?? [];
    let metrics;
    try {
      metrics = await listAllMemoryMetricsForInstance(cw, instanceId, hosts);
    } catch (e) {
      console.warn("Memory ListMetrics (full scan):", instanceId, e?.message ?? e);
      continue;
    }

    let dimSets = uniqueSortedDimensionSets(metrics);
    if (dimSets.length === 0) {
      dimSets = [[{ Name: "InstanceId", Value: instanceId }]];
    }

    for (const dimensions of dimSets) {
      try {
        const pts = await fetchMemoryDatapoints(
          cw,
          dimensions,
          start,
          end,
          periodSeconds,
          stat
        );
        if (seriesHasAnyPoint(pts)) {
          byId[instanceId] = pts;
          memoryDimensionCache.set(instanceId, {
            dims: dimensions,
            expires: Date.now() + MEMORY_DIM_CACHE_MS,
          });
          break;
        }
      } catch (e) {
        console.warn(
          "Memory fallback GetMetricData:",
          instanceId,
          e?.message ?? e
        );
      }
    }
  }

  const hasAny = instanceIds.some((id) =>
    seriesHasAnyPoint(byId[id] ?? [])
  );
  if (!hasAny) {
    console.warn(
      `No memory datapoints (${config.memory.namespace}/${config.memory.metricName}). ` +
        "Check AWS_REGION matches the instance, CW_MEMORY_NAMESPACE, and CW_MEMORY_ENABLED=true."
    );
    return { available: false, series: {} };
  }

  for (const id of instanceIds) {
    byId[id].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  return { available: true, series: byId };
}
