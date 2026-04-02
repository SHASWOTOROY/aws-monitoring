import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_PATH } from "./envFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: ENV_PATH });

/** @type {{ region: string; accessKeyId: string; secretAccessKey: string } | null} */
let runtimeAws = null;

export function setRuntimeAws(creds) {
  runtimeAws = {
    region: creds.region.trim(),
    accessKeyId: creds.accessKeyId.trim(),
    secretAccessKey: creds.secretAccessKey.trim(),
  };
  dotenv.config({ path: ENV_PATH, override: true });
}

export function clearRuntimeAws() {
  runtimeAws = null;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  dotenv.config({ path: ENV_PATH, override: true });
}

export function isAwsConfigured() {
  const r = runtimeAws?.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const k = runtimeAws?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
  const s = runtimeAws?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
  return Boolean(
    String(r ?? "").trim() &&
      String(k ?? "").trim() &&
      String(s ?? "").trim()
  );
}

export function getAwsRegion() {
  const r = runtimeAws?.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!String(r ?? "").trim()) {
    throw new Error("AWS region is not configured.");
  }
  return String(r).trim();
}

export function getAwsCredentials() {
  const accessKeyId = runtimeAws?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    runtimeAws?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!String(accessKeyId ?? "").trim() || !String(secretAccessKey ?? "").trim()) {
    throw new Error("AWS access key and secret key are not configured.");
  }
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  return {
    accessKeyId: String(accessKeyId).trim(),
    secretAccessKey: String(secretAccessKey).trim(),
    ...(sessionToken ? { sessionToken } : {}),
  };
}

export const config = {
  get port() {
    return Number(process.env.PORT) || 3001;
  },
  get frontendOrigin() {
    return process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  },
  instanceFilter: {
    get tagKey() {
      return process.env.INSTANCE_FILTER_TAG_KEY?.trim() || "";
    },
    get tagValue() {
      return process.env.INSTANCE_FILTER_TAG_VALUE?.trim() || "";
    },
  },
  memory: {
    get enabled() {
      return process.env.CW_MEMORY_ENABLED === "true";
    },
    get namespace() {
      return process.env.CW_MEMORY_NAMESPACE?.trim() || "CWAgent";
    },
    get metricName() {
      return process.env.CW_MEMORY_METRIC_NAME?.trim() || "mem_used_percent";
    },
    get extraHostCandidates() {
      return (
        process.env.CW_MEMORY_EXTRA_HOST_CANDIDATES?.split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean) ?? []
      );
    },
  },
};
