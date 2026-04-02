import { invalidateEc2Client } from "./services/ec2.js";
import { invalidateCloudWatchClient } from "./services/cloudwatch.js";
import { invalidate as cacheInvalidate } from "./cache.js";

export function invalidateAllAwsState() {
  invalidateEc2Client();
  invalidateCloudWatchClient();
  cacheInvalidate("ec2:");
}
