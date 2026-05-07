import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {Date} d
 */
function formatReportDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** MM/DD in UTC (CloudWatch-style). */
function formatUtcMmDd(ts) {
  const d = new Date(ts);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Y-axis tick label for percent scale. */
function formatYPercentTick(v) {
  if (v <= 0) return "0%";
  if (v < 0.01) return `${v.toFixed(3)}%`;
  if (v < 10) return `${v.toFixed(2)}%`;
  if (v < 100 - 1e-6) return `${v.toFixed(2)}%`;
  return "100%";
}

/**
 * Upper bound for percent axis (with headroom, CloudWatch-like), max 100.
 */
function yAxisUpperBound(vmax) {
  if (vmax <= 0) return 1;
  let cap =
    vmax < 0.5
      ? vmax * 2.2 + 0.05
      : vmax < 2
        ? vmax * 1.35 + 0.1
        : vmax < 10
          ? vmax * 1.22
          : vmax * 1.12;
  return Math.min(100, Math.max(cap, vmax + 1e-6));
}

function resolveLogoPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../public/logo.png"),
    path.resolve(here, "../../../public/image.png"),
    path.resolve(here, "../../../client/public/logo.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * @param {import("pdfkit").PDFDocument} doc
 * @param {string | null} logoPath
 * @param {number} pageNumber 1-based; PDFKit text must stay above maxY or it pages forever
 */
function drawPageFrame(doc, logoPath, pageNumber) {
  const ml = doc.page.margins.left;
  const mr = doc.page.margins.right;
  const mt = doc.page.margins.top;
  const mb = doc.page.margins.bottom;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  /** Bottom edge of the flow/content area — never place flowing `.text()` at or below this. */
  const maxY = pageH - mb;
  const contentW = pageW - ml - mr;

  /** Centered brand row: logo + wordmark, then coral rule (reference layout). */
  const brandWord = "Cloudly";
  const brandColor = "#7c2d2d";
  const ruleColor = "#e85d4c";
  const logoTop = 22;
  const logoW = 40;
  const logoH = 34;
  const wordmarkSize = 20;
  const logoTextGap = 10;

  doc.font("Helvetica-Bold").fontSize(wordmarkSize);
  const wordW = doc.widthOfString(brandWord);
  const rowW = (logoPath ? logoW + logoTextGap : 0) + wordW;
  const rowLeft = ml + Math.max(0, (contentW - rowW) / 2);

  if (logoPath) {
    doc.image(logoPath, rowLeft, logoTop, { fit: [logoW, logoH] });
  }
  const textX = logoPath ? rowLeft + logoW + logoTextGap : rowLeft;
  const textY = logoPath
    ? logoTop + (logoH - wordmarkSize) / 2 + 3
    : logoTop + 6;
  doc.font("Helvetica-Bold")
    .fontSize(wordmarkSize)
    .fillColor(brandColor)
    .text(brandWord, textX, textY, { lineBreak: false });

  const rulePad = 8;
  const ruleThickness = 3;
  const ruleTop = logoTop + logoH + 10;
  doc.save();
  doc.fillColor(ruleColor);
  doc
    .rect(ml + rulePad, ruleTop, contentW - 2 * rulePad, ruleThickness)
    .fill();
  doc.restore();

  /*
   * Footer: brand row just above a full-width decorative coral band (reference layout).
   * Band sits in the lower page margin (y ≥ maxY) so it does not steal flow height.
   */
  const footerBandH = 38;
  const bandTop = pageH - footerBandH;
  const bandBase = "#f4a896";
  const bandPatternFill = "#fff1eb";
  const bandPatternStroke = "#f9d8cd";

  doc.save();
  doc.rect(0, bandTop, pageW, footerBandH).fill(bandBase);
  /*
   * Avoid PDFClip + q/Q stacks here: in some PDF runtimes a clipping path can
   * remain effective for later text and make the whole body disappear. Pattern
   * dots are confined by loop bounds only.
   */
  const dotStep = 15;
  doc.fillOpacity(0.13);
  doc.fillColor(bandPatternFill);
  doc.strokeOpacity(0.2);
  doc.lineWidth(0.25);
  doc.strokeColor(bandPatternStroke);
  for (let cx = dotStep * 0.4; cx < pageW + dotStep; cx += dotStep * 0.95) {
    const rowOff =
      Math.floor((cx - dotStep * 0.4) / (dotStep * 1.9)) % 2 === 0
        ? 0
        : dotStep * 0.42;
    for (
      let cy = bandTop + dotStep * 0.35;
      cy < bandTop + footerBandH - dotStep * 0.2;
      cy += dotStep * 0.72
    ) {
      const yy = cy + rowOff;
      doc.circle(cx, yy, dotStep * 0.4).fill();
      doc.circle(cx, yy, dotStep * 0.5).stroke();
    }
  }
  doc.restore();
  if (typeof doc.opacity === "function") doc.opacity(1);
  else {
    doc.fillOpacity(1);
    doc.strokeOpacity(1);
  }

  const logoFits = [72, 22];
  // Place footer meta strictly inside the printable area (<= maxY),
  // otherwise PDFKit may create extra pages during stamping.
  const footerMetaY = maxY - 10;
  const logoFooterY = footerMetaY - logoFits[1] - 2;
  if (logoPath) doc.image(logoPath, ml, logoFooterY, { fit: logoFits });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#5f6b7a")
    .text("Cloud utilization report", ml + 82, footerMetaY, {
      width: 200,
      align: "left",
      lineBreak: false,
    });
  doc.text(`Page ${pageNumber}`, pageW - mr - 80, footerMetaY, {
    width: 80,
    align: "right",
    lineBreak: false,
  });

  /*
   * Footer `.text()` with explicit Y leaves PDFKit's cursor near `maxY`. Flowing
   * `.text({ align: "center" })` then thinks there is no room, adds blank pages,
   * or draws the body off the visible first page — so reset the cursor to the
   * content area for anything drawn after the frame.
   */
  doc.fillColor("#16191f");
  if (typeof doc.opacity === "function") doc.opacity(1);
  else {
    doc.fillOpacity(1);
    doc.strokeOpacity(1);
  }
  const headerRuleBottom = ruleTop + ruleThickness;
  /** Breathing room below the red rule before body text (esp. page 2+ instance blocks). */
  const gapBelowHeaderRule = 18;
  doc.x = ml;
  doc.y = Math.max(mt, headerRuleBottom + gapBelowHeaderRule);
}

/**
 * CloudWatch-style line chart: Y-axis "Percent" + % ticks + grid, X-axis MM/DD UTC, legend.
 * @param {import("pdfkit").PDFDocument} doc
 * @param {number} x
 * @param {number} yTop
 * @param {number} w
 * @param {number} h  Total vertical budget (plot + axes + legend + summary).
 * @param {Array<{ timestamp: string; value: number | null }>} series
 * @param {string} strokeColor
 * @param {string} chartTitle e.g. "CPU utilization (%)"
 * @param {string} instanceId
 * @param {string} instanceName
 */
function drawLineChart(
  doc,
  x,
  yTop,
  w,
  h,
  series,
  strokeColor,
  chartTitle,
  instanceId,
  instanceName
) {
  const leftAxisW = 46;
  const bottomAxisH = 22;
  const legendH = 12;
  const summaryLineH = 12;
  const captionH = 16; // reserve more vertical space so heading is not cramped
  const plotX = x + leftAxisW;
  const plotW = Math.max(40, w - leftAxisW - 4);
  const plotH = Math.max(
    52,
    h - bottomAxisH - legendH - summaryLineH - captionH - 4
  );
  const plotY = yTop + captionH + 2; // extra gap between title and plot frame

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#16191f")
    .text(chartTitle, x, yTop, { width: w, lineBreak: false });

  const pts = (series || []).filter(
    (p) => p.value != null && Number.isFinite(Number(p.value))
  );

  if (pts.length === 0) {
    doc.rect(plotX, plotY, plotW, plotH).stroke("#d5dbdb");
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text("No data in this range.", plotX, plotY + plotH / 2 - 6, {
        width: plotW,
        align: "center",
      });
    const afterPlot = plotY + plotH + bottomAxisH + 4;
    return afterPlot + legendH + summaryLineH;
  }

  const vals = pts.map((p) => Number(p.value));
  const vmaxData = Math.max(...vals, 0);
  const ymax = yAxisUpperBound(vmaxData);
  const t0 = new Date(pts[0].timestamp).getTime();
  const t1 = new Date(pts[pts.length - 1].timestamp).getTime();
  const tr = Math.max(t1 - t0, 1);

  const yTickCount = 5;
  const yTicks = [];
  for (let i = 0; i < yTickCount; i++) {
    yTicks.push((ymax * i) / (yTickCount - 1));
  }

  /** Rotated "Percent" on the left (CloudWatch). */
  doc.save();
  doc.translate(x + 8, plotY + plotH / 2);
  doc.rotate(-Math.PI / 2);
  doc.font("Helvetica").fontSize(9).fillColor("#545b64");
  doc.text("Percent", -18, -3, { lineBreak: false });
  doc.restore();

  doc.save();
  doc.lineWidth(0.35).strokeColor("#e9ebed");
  for (const tickVal of yTicks) {
    const gy = plotY + plotH - (tickVal / ymax) * plotH;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).stroke();
  }
  doc.restore();

  doc.rect(plotX, plotY, plotW, plotH).stroke("#d5dbdb");

  for (const tickVal of yTicks) {
    const gy = plotY + plotH - (tickVal / ymax) * plotH;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#545b64")
      .text(formatYPercentTick(tickVal), x + 2, gy - 4, {
        width: leftAxisW - 8,
        align: "right",
        lineBreak: false,
      });
    doc.save();
    doc.strokeColor("#545b64").lineWidth(0.6);
    doc.moveTo(plotX - 3, gy).lineTo(plotX, gy).stroke();
    doc.restore();
  }

  doc.save();
  doc.strokeColor(strokeColor).lineWidth(1.35);
  doc.lineJoin("round");
  let started = false;
  for (const p of pts) {
    const px =
      plotX + ((new Date(p.timestamp).getTime() - t0) / tr) * plotW;
    const py = plotY + plotH - (Number(p.value) / ymax) * plotH;
    if (!started) {
      doc.moveTo(px, py);
      started = true;
    } else {
      doc.lineTo(px, py);
    }
  }
  doc.stroke();
  doc.restore();

  const nx = Math.min(8, Math.max(3, Math.floor(plotW / 64)));
  doc.save();
  doc.strokeColor("#545b64").lineWidth(0.6);
  doc.font("Helvetica").fontSize(7).fillColor("#545b64");
  for (let i = 0; i < nx; i++) {
    const frac = nx > 1 ? i / (nx - 1) : 0;
    const tiMs = t0 + frac * tr;
    const gx = plotX + frac * plotW;
    doc.moveTo(gx, plotY + plotH).lineTo(gx, plotY + plotH + 3).stroke();
    const label = formatUtcMmDd(tiMs);
    doc.text(label, gx - 16, plotY + plotH + 4, {
      width: 32,
      align: "center",
      lineBreak: false,
    });
  }
  doc.restore();

  const legY = plotY + plotH + bottomAxisH - 2;
  const swW = 12;
  const swH = 3;
  doc.rect(plotX, legY, swW, swH).fill(strokeColor);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#16191f")
    .text(
      `${instanceId} [${instanceName}]`,
      plotX + swW + 5,
      legY - 1,
      { width: plotW - swW - 8, lineBreak: false }
    );

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#545b64")
    .text(
      `0% — ${vmaxData.toFixed(1)}% max · ${pts.length} points`,
      x,
      legY + legendH + 2
    );

  return legY + legendH + summaryLineH + 8;
}

/**
 * @param {object} opts
 * @param {Array<{
 *   name: string;
 *   instanceId: string;
 *   specLabel: string;
 * }>} opts.instances
 * @param {Record<string, Array<{ timestamp: string; value: number | null }>>} opts.cpuById
 * @param {Record<string, Array<{ timestamp: string; value: number | null }>>} opts.memoryById
 * @param {boolean} opts.memoryAvailable
 * @param {string} opts.rangeLabel
 * @param {string} opts.periodLabel
 * @param {string} opts.statistic
 * @returns {Promise<Buffer>}
 */
export function buildUtilizationReportPdf(opts) {
  const {
    instances,
    cpuById,
    memoryById,
    memoryAvailable,
    rangeLabel,
    periodLabel,
    statistic,
  } = opts;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const logoPath = resolveLogoPath();
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 74, bottom: 66, left: 48, right: 48 },
    });
    let pageSeq = 0;
    const stampPageFrame = () => {
      pageSeq += 1;
      drawPageFrame(doc, logoPath, pageSeq);
    };
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    stampPageFrame();

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#16191f")
      .text("EC2 CPU and Memory Utilization Report", { align: "center" });
    doc.moveDown(0.25);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#16191f")
      .text(`Date: ${formatReportDate(new Date())}`, { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor("#545b64")
      .text(
        `Range ${rangeLabel} · ${periodLabel} · ${statistic} · UTC`,
        { align: "center" }
      );
    doc.moveDown(1.2);

    if (!instances.length) {
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#545b64")
        .text(
          "No EC2 instances matched the current filters for this report. " +
            "Check running instances and tag filters in server configuration.",
          { align: "left" }
        );
      doc.end();
      return;
    }

    let n = 1;
    for (const inst of instances) {
      if (n > 1) {
        doc.addPage();
        stampPageFrame();
      }
      const spec = inst.specLabel || "";
      const infoW =
        doc.page.width -
        (doc.page.margins?.left ?? 50) -
        (doc.page.margins?.right ?? 50);
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor("#16191f")
        .text(`${n}. ${inst.name} ${spec}`, {
          width: infoW,
          ellipsis: true,
          lineBreak: false,
        });
      doc.moveDown(0.5);

      let y = doc.y;
      const ml = doc.page.margins?.left ?? 50;
      const mr = doc.page.margins?.right ?? 50;
      const chartW = doc.page.width - ml - mr;
      y = drawLineChart(
        doc,
        ml,
        y,
        chartW,
        152,
        cpuById[inst.instanceId] ?? [],
        "#0972d3",
        "CPU utilization (%)",
        inst.instanceId,
        inst.name
      );
      doc.y = y;
      doc.moveDown(0.6);

      y = doc.y;
      const memSeries =
        memoryAvailable && memoryById[inst.instanceId]?.length
          ? memoryById[inst.instanceId]
          : [];
      y = drawLineChart(
        doc,
        ml,
        y,
        chartW,
        152,
        memSeries,
        "#1d8102",
        "Memory utilization (%)",
        inst.instanceId,
        inst.name
      );
      doc.y = y;
      n += 1;
    }

    doc.end();
  });
}
