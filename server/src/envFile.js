import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = path.join(__dirname, "..", ".env");

const MANAGED_KEYS = new Set([
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

/**
 * Drop active and commented-out assignments of managed AWS keys.
 */
function shouldDropAwsCredentialLine(line) {
  const raw = line.trim();
  if (!raw) return false;
  const withoutCommentHash = raw.startsWith("#")
    ? raw.replace(/^\s*#\s*/, "").trim()
    : raw;
  if (!withoutCommentHash.includes("=")) return false;
  const keyPart = withoutCommentHash.split("=")[0]?.trim();
  return Boolean(keyPart && MANAGED_KEYS.has(keyPart));
}

export function readEnvFile() {
  try {
    return fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    return "";
  }
}

export function mergeAwsIntoEnvFile({ region, accessKeyId, secretAccessKey }) {
  const lines = [];
  for (const line of readEnvFile().split(/\r?\n/)) {
    if (shouldDropAwsCredentialLine(line)) continue;
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(`AWS_REGION=${region}`);
  lines.push(`AWS_ACCESS_KEY_ID=${accessKeyId}`);
  lines.push(`AWS_SECRET_ACCESS_KEY=${secretAccessKey}`);
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf8");
}

export function stripAwsFromEnvFile() {
  const lines = [];
  for (const line of readEnvFile().split(/\r?\n/)) {
    if (shouldDropAwsCredentialLine(line)) continue;
    lines.push(line);
  }
  fs.writeFileSync(
    ENV_PATH,
    `${lines.join("\n").replace(/\n+$/, "\n")}`,
    "utf8"
  );
}
