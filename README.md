# AWS EC2 monitoring (React + Node.js)

Read-only dashboard: instance **Name** (tag), **CPU utilization** from CloudWatch, and **memory** when the CloudWatch Agent publishes it. No database; data is fetched live from AWS.

## What you need from the AWS account

1. **Region** where the EC2 instances run (for example `us-east-1`).
2. **Credentials** for an IAM principal used only for this app (least privilege; rotate keys if using access keys).
3. **IAM permissions** (see policy below): `DescribeInstances`, `GetMetricData`, `ListMetrics` (memory uses `ListMetrics` once per instance to match the CloudWatch Agent’s full dimension set).
4. **EC2 Name tags** on instances so the table shows friendly names (falls back to instance id).
5. **CPU**: default EC2 metric `AWS/EC2` → `CPUUtilization` (no extra setup).
6. **Memory** (optional, later): install the CloudWatch Agent and publish `mem_used_percent` (defaults in `.env.example` assume namespace `CWAgent`). The API resolves metrics whether the agent attaches **`InstanceId`**, **`host`** (private DNS), or both (via `DescribeInstances` + `ListMetrics`). Until metrics exist, the Memory column stays empty.

## Server environment

Copy `server/.env.example` to `server/.env`. Fill in **only on your machine or the server**; never commit `.env` or paste secrets into GitHub.

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | Region for EC2 + CloudWatch |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | If not using an IAM role | Keys for the dedicated IAM user or STS session |
| `AWS_SESSION_TOKEN` | If using temporary creds | Session token |
| `FRONTEND_ORIGIN` | Yes in production | Exact browser origin allowed by CORS (e.g. `https://monitoring.example.com`) |
| `PORT` | No | API port (default `3001`) |
| `CW_MEMORY_ENABLED` | No | `false` (default): do not query CloudWatch for memory. Set `true` after the agent publishes `mem_used_percent`. |
| `INSTANCE_FILTER_TAG_KEY` / `INSTANCE_FILTER_TAG_VALUE` | No | Limit instances to one tag pair |

If the Node process runs on **EC2/ECS/Lambda** with an **IAM role**, you can omit access keys and attach the same permissions to the role.

## IAM user (e.g. `monitoring-app`) — CPU now, memory later

Use a **dedicated IAM user** (or role) with **only** the policy below. Attach **access keys** for that user to `server/.env` if the API runs outside AWS.

- **CPU today:** Works with default EC2 metrics (`AWS/EC2` → `CPUUtilization`). No CloudWatch Agent required on instances.
- **Memory later:** The UI **Memory** column and `/api/dashboard` **memory** payload stay in place. Values stay **—** until you install the **CloudWatch Agent** and publish metrics (e.g. `CWAgent` / `mem_used_percent`). Then the same `GetMetricData` permission will populate that column—no app change required.

### `AmazonEC2ReadOnlyAccess` is not enough for this app

The managed policy **[AmazonEC2ReadOnlyAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonEC2ReadOnlyAccess.html)** allows EC2 read APIs (e.g. `DescribeInstances`) but **does not** include **`cloudwatch:GetMetricData`**. Without that action, the API cannot read CPU (or any metric), and you will see: *not authorized to perform: cloudwatch:GetMetricData*.

**CPU metrics already exist in CloudWatch** for EC2 by default—you do not need to “configure CloudWatch” on the server first for CPU. You only need **IAM permission to read metrics**.

**Fix:** Attach **both** of these managed policies to the same IAM user (e.g. `monitoring-app`)—this matches what you need for this app:

| Managed policy | Purpose |
|----------------|---------|
| **[AmazonEC2ReadOnlyAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonEC2ReadOnlyAccess.html)** | List/describe EC2 instances (names, ids). |
| **[CloudWatchReadOnlyAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/CloudWatchReadOnlyAccess.html)** | Read CloudWatch metrics, including **`cloudwatch:GetMetricData`** for CPU graphs. |

Alternatively, use the single inline JSON policy in the next section instead of the two managed policies.

### Memory before the CloudWatch Agent

Keep **`CW_MEMORY_ENABLED=false`** in `server/.env` (default) until the agent publishes memory metrics. The UI **Memory** column stays (shows **—**); the API **skips** CloudWatch memory queries so you do not get errors from missing `CWAgent` metrics. **`CloudWatchReadOnlyAccess` already allows** reading those metrics later—no second “memory permission” is required. When ready: install the agent, then set **`CW_MEMORY_ENABLED=true`**.

## IAM policy (example)

Attach this to the IAM user or role used by the API (e.g. `monitoring-app`). Tighten with conditions if your org requires it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MonitoringReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "cloudwatch:GetMetricData",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```

## Run locally

1. `cd server && npm install` and `cd client && npm install`.
2. Copy `server/.env.example` to `server/.env`. Set `FRONTEND_ORIGIN=http://localhost:5173`, `PORT` (e.g. `3001` or `3002`), and memory flags if needed. You can **omit** `AWS_REGION` / keys and enter them in the UI instead.
3. If `PORT` is not `3001`, add `client/.env` with `VITE_API_PROXY_PORT=<same port>` (see `client/.env.example`).
4. **Terminal A:** `cd server && npm run dev`
5. **Terminal B:** `cd client && npm run dev`
6. Open `http://localhost:5173` and connect AWS when prompted (or use keys already in `.env`).

## Production (typical)

- Build the client: `cd client && npm run build`; serve `client/dist` as static files.
- Run the API behind HTTPS; set `FRONTEND_ORIGIN` to your real UI origin.
- Prefer **one hostname** with a reverse proxy: `/` → static SPA, `/api` → Node. Then you do not need `VITE_API_BASE` (same-origin requests).
- If the UI and API use **different hostnames**, set `VITE_API_BASE` at build time to the API origin (see `client/.env.example`).

## Security checklist

- `.env` is listed in `.gitignore`; verify secrets are never committed.
- Use a **dedicated IAM user or role** with the smallest policy above.
- **HTTPS** in production; do not expose the API on plain HTTP on the public internet without a reverse proxy and firewall rules.
- **CORS** is restricted to `FRONTEND_ORIGIN` (not `*`).
- The API uses **Helmet**, **rate limiting**, read-only metric **GET**s, and **POST** endpoints only for saving or clearing AWS credentials and generating a PDF.

## Web UI: connect AWS and PDF report

1. Start the API and the Vite client (see **Run locally**).
2. Open the app. If no AWS credentials are configured, the **Connect to AWS** form appears. A successful check stores credentials only on this server (for example in `server/.env`) so the API can call AWS.
3. The dashboard loads for that account/region (same CPU/memory behavior as before).
4. **Generate PDF report** downloads the PDF, then **removes** region and keys from `server/.env`, clears server memory, and **reloads the page** so the browser state is reset. **Disconnect** does the same without generating a PDF.
5. If `.env` already contains valid keys when the server starts, the setup form is skipped.

### Extra API routes

- `GET /api/config/status` — `{ configured, region }` (no secrets).
- `POST /api/config/aws` — JSON `{ region, accessKeyId, secretAccessKey }`.
- `POST /api/config/clear` — remove stored AWS keys from `.env` and memory.
- `GET /api/report/pdf?range=1w&statistic=Average` — PDF attachment.

## API

- `GET /api/health` — liveness.
- `GET /api/instances` — cached ~60s list of running instances (name + id). **Requires** configured AWS credentials.
- `GET /api/dashboard?range=1w&statistic=Average&period=300` — instances plus batched CPU (and memory when available). Ranges: `1h`, `3h`, `12h`, `1d`, `3d`, `1w`, `1m`.

CPU queries are batched with `GetMetricData` (up to 100 metrics per request) to keep responses fast for many instances.
