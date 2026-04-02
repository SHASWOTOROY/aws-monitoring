import { Router } from "express";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { mergeAwsIntoEnvFile, stripAwsFromEnvFile } from "../envFile.js";
import {
  setRuntimeAws,
  clearRuntimeAws,
  isAwsConfigured,
  getAwsRegion,
  config,
} from "../config.js";
import { invalidateAllAwsState } from "../invalidateAws.js";
import { buildUtilizationReportPdf } from "../services/reportPdf.js";
import {
  listMonitoredInstances,
  getInstanceTypeSpecs,
} from "../services/ec2.js";
import { getCpuSeries, getMemorySeries } from "../services/cloudwatch.js";
import {
  resolveTimeWindowFromQuery,
  resolvePeriodSeconds,
} from "../timeRange.js";
import {
  httpStatusFromAwsError,
  isAwsCredentialLikeError,
} from "../awsErrorStatus.js";

export const setupRouter = Router();

function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
}

setupRouter.use(noStore);

setupRouter.get("/config/status", (_req, res) => {
  const configured = isAwsConfigured();
  let region = "";
  if (configured) {
    try {
      region = getAwsRegion();
    } catch {
      region = "";
    }
  }
  res.json({ configured, region });
});

setupRouter.post("/config/aws", async (req, res, next) => {
  try {
    const { region, accessKeyId, secretAccessKey } = req.body || {};
    if (
      !String(region ?? "").trim() ||
      !String(accessKeyId ?? "").trim() ||
      !String(secretAccessKey ?? "").trim()
    ) {
      return res.status(400).json({
        error: "region, accessKeyId, and secretAccessKey are required",
      });
    }
    const r = String(region).trim();
    const ak = String(accessKeyId).trim();
    const sk = String(secretAccessKey).trim();

    let id;
    try {
      const sts = new STSClient({
        region: r,
        credentials: { accessKeyId: ak, secretAccessKey: sk },
      });
      id = await sts.send(new GetCallerIdentityCommand({}));
    } catch (e) {
      if (isAwsCredentialLikeError(e)) {
        return res.status(401).json({
          error:
            "AWS rejected these credentials. Check region, access key ID, and secret key.",
        });
      }
      const st = httpStatusFromAwsError(e);
      if (st >= 400 && st < 500) {
        return res.status(st).json({
          error: String(e.message || "AWS request failed"),
        });
      }
      throw e;
    }

    try {
      mergeAwsIntoEnvFile({ region: r, accessKeyId: ak, secretAccessKey: sk });
    } catch (diskErr) {
      if (diskErr?.code === "EACCES" || diskErr?.code === "EPERM") {
        return res.status(500).json({
          error:
            "Could not save credentials to server/.env (permission denied).",
        });
      }
      throw diskErr;
    }
    setRuntimeAws({ region: r, accessKeyId: ak, secretAccessKey: sk });
    invalidateAllAwsState();

    res.json({
      ok: true,
      account: id.Account,
      arn: id.Arn,
      userId: id.UserId,
    });
  } catch (e) {
    next(e);
  }
});

setupRouter.post("/config/clear", (_req, res, next) => {
  try {
    stripAwsFromEnvFile();
    clearRuntimeAws();
    invalidateAllAwsState();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

setupRouter.get("/report/pdf", async (req, res, next) => {
  try {
    if (!isAwsConfigured()) {
      return res.status(401).json({
        error: "AWS credentials not configured",
        code: "AWS_NOT_CONFIGURED",
      });
    }

    const statistic =
      typeof req.query.statistic === "string" ? req.query.statistic : "Average";
    const periodParam = req.query.period
      ? Number(req.query.period)
      : undefined;

    const { start, end, rangeLabel, periodRangeKey } =
      resolveTimeWindowFromQuery(req.query);
    const periodSeconds = resolvePeriodSeconds(
      periodRangeKey,
      periodParam,
      start,
      end
    );

    const instances = await listMonitoredInstances();
    const ids = instances.map((i) => i.instanceId);
    const instanceHostCandidatesById = Object.fromEntries(
      instances.map((i) => [
        i.instanceId,
        [...(i.memoryHostCandidates ?? []), ...config.memory.extraHostCandidates],
      ])
    );

    const typeMap = await getInstanceTypeSpecs(
      instances.map((i) => i.instanceType)
    );

    const instancesForPdf = instances.map((inst) => {
      const spec = typeMap.get(inst.instanceType);
      const specLabel = spec
        ? `[Core ${spec.vcpu}, RAM ${spec.ramGb} GB]`
        : inst.instanceType
          ? `[${inst.instanceType}]`
          : "";
      return {
        name: inst.name,
        instanceId: inst.instanceId,
        instanceType: inst.instanceType ?? "",
        specLabel,
        state: inst.state ?? "unknown",
        os: inst.platform ?? "",
        publicIp: inst.publicIpAddress ?? "",
        privateIp: inst.privateIpAddress ?? "",
        privateDns: inst.privateDnsName ?? "",
        availabilityZone: inst.availabilityZone ?? "",
        vpcId: inst.vpcId ?? "",
        subnetId: inst.subnetId ?? "",
        launchTime: inst.launchTime ?? null,
      };
    });

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
        console.warn("Report memory metrics skipped:", memErr);
      }
    }

    const buf = await buildUtilizationReportPdf({
      instances: instancesForPdf,
      cpuById: cpu,
      memoryById: memory.series,
      memoryAvailable: memory.available,
      rangeLabel,
      periodLabel: `${periodSeconds}s`,
      statistic,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ec2-utilization-report.pdf"'
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
});
