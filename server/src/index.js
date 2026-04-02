import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, isAwsConfigured, getAwsRegion } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { setupRouter } from "./routes/setup.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: config.frontendOrigin,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path?.startsWith("/api/health") || req.path?.startsWith("/api/config"),
  })
);

app.use(express.json({ limit: "32kb" }));

app.use("/api", setupRouter);
app.use("/api", apiRouter);

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  const isAws = Boolean(err?.$metadata);
  let status = 500;
  if (err?.statusCode && Number.isFinite(err.statusCode)) {
    status = err.statusCode;
  } else if (isAws && Number.isFinite(err.$metadata?.httpStatusCode)) {
    status = err.$metadata.httpStatusCode;
  }
  const clientErr =
    status >= 400 && status < 500 ? err.message || "Request failed" : null;
  const message =
    clientErr ??
    (isAws ? err.message || "AWS request failed" : "Internal server error");
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

const server = app.listen(config.port, () => {
  const regionHint = isAwsConfigured()
    ? `region ${getAwsRegion()}`
    : "AWS credentials not set — open the UI to connect";
  console.log(`API listening on port ${config.port} (${regionHint})`);
});

/** Avoid proxy / client cutting long PDF + CloudWatch calls (0 = no timeout). */
server.setTimeout(0);
server.keepAliveTimeout = 75_000;

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${config.port} is already in use.\n` +
        `Stop the other process (or close the other terminal running this API), or set a different PORT in server/.env.\n` +
        `Windows — find PID: netstat -ano | findstr :${config.port}\n` +
        `Then: taskkill /PID <pid> /F\n`
    );
    process.exit(1);
  }
  throw err;
});
