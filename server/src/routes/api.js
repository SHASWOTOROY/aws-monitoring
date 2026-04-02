import { Router } from "express";
import { config, isAwsConfigured } from "../config.js";
import { listMonitoredInstances } from "../services/ec2.js";
import { getCpuSeries, getMemorySeries } from "../services/cloudwatch.js";
import { resolveTimeWindowFromQuery, resolvePeriodSeconds } from "../timeRange.js";
import { getOrSet } from "../cache.js";

export const apiRouter = Router();

function requireAws(_req, res, next) {
  if (!isAwsConfigured()) {
    return res.status(401).json({
      error: "AWS credentials not configured",
      code: "AWS_NOT_CONFIGURED",
    });
  }
  next();
}

const INSTANCE_CACHE_MS = 60_000;
const INSTANCE_CACHE_KEY = "ec2:instances:v2";

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aws-monitoring-api" });
});

apiRouter.get("/instances", requireAws, async (_req, res, next) => {
  try {
    const instances = await getOrSet(INSTANCE_CACHE_KEY, INSTANCE_CACHE_MS, () =>
      listMonitoredInstances()
    );
    res.json({
      instances: instances.map(({ instanceId, name, state }) => ({
        instanceId,
        name,
        state,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Full dashboard payload: instances + CPU time series (+ memory when available).
 * Query: range, period (seconds), statistic
 */
apiRouter.get("/dashboard", requireAws, async (req, res, next) => {
  try {
    const periodParam = req.query.period
      ? Number(req.query.period)
      : undefined;
    const statistic =
      typeof req.query.statistic === "string" ? req.query.statistic : "Average";

    const { start, end, rangeLabel, periodRangeKey } =
      resolveTimeWindowFromQuery(req.query);
    const periodSeconds = resolvePeriodSeconds(
      periodRangeKey,
      periodParam,
      start,
      end
    );

    const instances = await getOrSet(INSTANCE_CACHE_KEY, INSTANCE_CACHE_MS, () =>
      listMonitoredInstances()
    );

    const ids = instances.map((i) => i.instanceId);
    const instanceHostCandidatesById = Object.fromEntries(
      instances.map((i) => [
        i.instanceId,
        [...(i.memoryHostCandidates ?? []), ...config.memory.extraHostCandidates],
      ])
    );
    const instancesForClient = instances.map(({ instanceId, name, state }) => ({
      instanceId,
      name,
      state,
    }));

    if (ids.length === 0) {
      return res.json({
        range: rangeLabel,
        periodSeconds,
        statistic,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        instances: [],
        cpu: {},
        memory: { available: false, series: {} },
      });
    }

    const cpu = await getCpuSeries({
      instanceIds: ids,
      start,
      end,
      periodSeconds,
      statistic,
    });

    let memory = { available: false, series: {} };
    if (config.memory.enabled) {
      try {
        memory = await getMemorySeries({
          instanceIds: ids,
          instanceHostCandidatesById,
          start,
          end,
          periodSeconds,
          statistic,
        });
      } catch (memErr) {
        console.warn("Memory metrics skipped:", memErr);
      }
    }

    res.json({
      range: rangeLabel,
      periodSeconds,
      statistic,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      instances: instancesForClient,
      cpu,
      memory,
    });
  } catch (e) {
    next(e);
  }
});
