import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceTypesCommand,
} from "@aws-sdk/client-ec2";
import { config, getAwsCredentials, getAwsRegion } from "../config.js";

let client;

/**
 * CW Agent `host` is often the short hostname (e.g. ip-10-0-1-5), not the full PrivateDnsName FQDN.
 * @param {import("@aws-sdk/client-ec2").Instance} inst
 * @returns {string[]}
 */
export function memoryHostCandidatesFromInstance(inst) {
  const set = new Set();
  const dns = inst.PrivateDnsName?.trim();
  if (dns) {
    set.add(dns);
    const first = dns.split(".")[0];
    if (first) set.add(first);
  }
  const ip = inst.PrivateIpAddress?.trim();
  if (ip && !ip.includes(":")) {
    set.add(`ip-${ip.replace(/\./g, "-")}`);
  }
  return [...set];
}

function getClient() {
  if (!client) {
    client = new EC2Client({
      region: getAwsRegion(),
      credentials: getAwsCredentials(),
    });
  }
  return client;
}

export function invalidateEc2Client() {
  client = undefined;
}

/**
 * @returns {Promise<Array<{
 *   instanceId: string;
 *   name: string;
 *   state: string;
 *   instanceType: string;
 *   platform: string;
 *   publicIpAddress: string;
 *   privateIpAddress: string;
 *   privateDnsName: string;
 *   availabilityZone: string;
 *   vpcId: string;
 *   subnetId: string;
 *   launchTime: Date | null;
 *   memoryHostCandidates: string[];
 * }>>}
 */
export async function listMonitoredInstances() {
  const ec2 = getClient();
  const filters = [
    { Name: "instance-state-name", Values: ["running"] },
  ];

  if (config.instanceFilter.tagKey && config.instanceFilter.tagValue) {
    filters.push({
      Name: `tag:${config.instanceFilter.tagKey}`,
      Values: [config.instanceFilter.tagValue],
    });
  }

  const out = await ec2.send(
    new DescribeInstancesCommand({ Filters: filters })
  );

  const rows = [];
  for (const r of out.Reservations ?? []) {
    for (const inst of r.Instances ?? []) {
      const id = inst.InstanceId;
      if (!id) continue;
      const nameTag = (inst.Tags ?? []).find((t) => t.Key === "Name");
      const name = nameTag?.Value?.trim() || id;
      rows.push({
        instanceId: id,
        name,
        state: inst.State?.Name ?? "unknown",
        instanceType: inst.InstanceType ?? "",
        platform: inst.Platform ?? "",
        publicIpAddress: inst.PublicIpAddress ?? "",
        privateIpAddress: inst.PrivateIpAddress ?? "",
        privateDnsName: inst.PrivateDnsName ?? "",
        availabilityZone: inst.Placement?.AvailabilityZone ?? "",
        vpcId: inst.VpcId ?? "",
        subnetId: inst.SubnetId ?? "",
        launchTime: inst.LaunchTime ?? null,
        memoryHostCandidates: memoryHostCandidatesFromInstance(inst),
      });
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/**
 * @param {string[]} instanceTypes
 * @returns {Promise<Map<string, { vcpu: number; ramGb: number }>>}
 */
export async function getInstanceTypeSpecs(instanceTypes) {
  const unique = [...new Set(instanceTypes.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  const ec2 = getClient();
  const resp = await ec2.send(
    new DescribeInstanceTypesCommand({ InstanceTypes: unique })
  );
  for (const t of resp.InstanceTypes ?? []) {
    if (!t.InstanceType) continue;
    const vcpu = t.VCpuInfo?.DefaultVCpus ?? 0;
    const memMiB = t.MemoryInfo?.SizeInMiB ?? 0;
    const ramGb = Math.max(1, Math.round(memMiB / 1024));
    map.set(t.InstanceType, { vcpu, ramGb });
  }
  return map;
}
