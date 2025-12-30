import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

dayjs.extend(utc);
dayjs.extend(timezone);

const MST = "America/Denver";

// ============================================
// CONFIGURATION - Easy to update values
// ============================================
const HOURLY_RATE = 55.0;
const CLIENT_NAME = "Merging Solutions, LLC";
const CONTACT_NAME = "Daniel Piper";
const CONTACT_PHONE = "(541) 363-9921";
const CONTACT_EMAIL = "daniel@danielpiper.dev";
// ============================================

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;

interface TimeEntry {
  date: Dayjs;
  hours: number;
  description: string;
}

interface WeekGroup {
  [weekNum: number]: TimeEntry[];
}

interface BillingEntry {
  date: string;
  description: string;
  amount: number;
}

/**
 * Get invoice date based on current date
 * Days 1-14: invoice for last month (last day of that month)
 * Days 15-31: invoice for current month (last day of current month)
 */
function getInvoiceDate(): Dayjs {
  const today = dayjs().tz(MST);
  if (today.date() < 15) {
    const lastMonth = today.subtract(1, "month");
    return lastMonth.endOf("month");
  } else {
    return today.endOf("month");
  }
}

/**
 * Get week number within month (1-indexed, weeks start on Sunday)
 */
function getWeekNumber(date: Dayjs): number {
  const firstDay = date.startOf("month");
  const daysUntilSunday = (7 - firstDay.day()) % 7;
  const firstSun = firstDay.add(daysUntilSunday, "day");

  if (date.isBefore(firstSun)) {
    return 1;
  }

  const base = firstSun.isSame(firstDay, "day") ? 1 : 2;
  return Math.floor(date.diff(firstSun, "day") / 7) + base;
}

/**
 * Group entries by week number for a specific month
 */
function groupEntriesByWeek(entries: TimeEntry[], monthYear: string): WeekGroup {
  const weeks: WeekGroup = {};

  for (const entry of entries) {
    if (entry.date.format("MMMM YYYY") === monthYear) {
      const weekNum = getWeekNumber(entry.date);
      if (!weeks[weekNum]) {
        weeks[weekNum] = [];
      }
      weeks[weekNum].push(entry);
    }
  }

  return weeks;
}

/**
 * Format ordinal suffix for day (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Generate Invoice PDF using pdf-lib
 */
async function generateInvoicePdf(invoiceDate: Dayjs, weeks: WeekGroup): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const monthYear = invoiceDate.format("MMMM YYYY");
  const billingEntries: BillingEntry[] = [];
  let totalAmount = 0;

  const sortedWeeks = Object.keys(weeks)
    .map(Number)
    .sort((a, b) => a - b);

  for (const weekNum of sortedWeeks) {
    const weekEntries = weeks[weekNum];
    const weekHours = weekEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const weekAmount = weekHours * HOURLY_RATE;
    totalAmount += weekAmount;

    const weekStart = weekEntries.reduce(
      (min, entry) => (entry.date.isBefore(min) ? entry.date : min),
      weekEntries[0].date
    );
    const weekEnd = weekEntries.reduce(
      (max, entry) => (entry.date.isAfter(max) ? entry.date : max),
      weekEntries[0].date
    );

    const weekLabel = `${monthYear} Week ${weekNum} (${weekStart.format("M/D")} - ${weekEnd.format("M/D")})`;

    billingEntries.push({
      date: weekEnd.format("MM/DD/YY"),
      description: weekLabel,
      amount: weekAmount,
    });
  }

  const paymentDueDate = invoiceDate.add(45, "day").date(15);
  const paymentDueDateStr = `${paymentDueDate.format("MMMM")} ${paymentDueDate.date()}${getOrdinalSuffix(paymentDueDate.date())}`;
  const invoiceDateStr = `${invoiceDate.format("MMMM")} ${invoiceDate.date()}${getOrdinalSuffix(invoiceDate.date())}, ${invoiceDate.year()}`;

  let y = height - 50;
  const leftMargin = 50;
  const rightMargin = 562;

  // Header
  page.drawText("Invoice", { x: leftMargin, y, size: 28, font: helveticaBold });
  y -= 25;

  page.drawText(invoiceDateStr, { x: leftMargin, y, size: 14, font: helvetica });
  y -= 20;

  page.drawText(`${CONTACT_NAME} - ${CONTACT_PHONE} - ${CONTACT_EMAIL}`, {
    x: leftMargin,
    y,
    size: 11,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 25;

  // Divider line
  page.drawLine({
    start: { x: leftMargin, y },
    end: { x: rightMargin, y },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  y -= 25;

  // Billed to
  page.drawText(`The following is billed to ${CLIENT_NAME} for ${monthYear}`, {
    x: leftMargin,
    y,
    size: 12,
    font: helveticaBold,
  });
  y -= 25;

  // Table header
  const col1X = leftMargin;
  const col2X = leftMargin + 80;
  const col3X = rightMargin - 70;
  const tableTop = y;

  // Header row background
  page.drawRectangle({
    x: leftMargin,
    y: y - 5,
    width: rightMargin - leftMargin,
    height: 20,
    color: rgb(0.95, 0.95, 0.95),
  });

  page.drawText("Date", { x: col1X + 5, y: y, size: 10, font: helveticaBold });
  page.drawText("Description", { x: col2X + 5, y: y, size: 10, font: helveticaBold });
  page.drawText("Amount", { x: col3X + 5, y: y, size: 10, font: helveticaBold });
  y -= 20;

  // Table rows
  for (const entry of billingEntries) {
    page.drawText(entry.date, { x: col1X + 5, y, size: 10, font: helvetica });
    page.drawText(entry.description, { x: col2X + 5, y, size: 10, font: helvetica });
    page.drawText(`$${entry.amount.toFixed(2)}`, { x: col3X + 5, y, size: 10, font: helvetica });
    y -= 18;
  }

  // Table borders
  const tableBottom = y + 13;

  // Outer border
  page.drawRectangle({
    x: leftMargin,
    y: tableBottom,
    width: rightMargin - leftMargin,
    height: tableTop - tableBottom + 15,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  // Column dividers
  page.drawLine({
    start: { x: col2X, y: tableTop + 15 },
    end: { x: col2X, y: tableBottom },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: col3X, y: tableTop + 15 },
    end: { x: col3X, y: tableBottom },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  // Header row divider
  page.drawLine({
    start: { x: leftMargin, y: tableTop - 5 },
    end: { x: rightMargin, y: tableTop - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  y -= 15;

  // Total
  const totalStr = `Total: $${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totalWidth = helveticaBold.widthOfTextAtSize(totalStr, 14);
  page.drawText(totalStr, {
    x: rightMargin - totalWidth,
    y,
    size: 14,
    font: helveticaBold,
  });
  y -= 25;

  // Divider line
  page.drawLine({
    start: { x: leftMargin, y },
    end: { x: rightMargin, y },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  y -= 25;

  // Payment notes
  page.drawText("Payment Notes:", { x: leftMargin, y, size: 12, font: helveticaBold });
  y -= 18;

  page.drawText("• Payment via direct deposit", { x: leftMargin + 10, y, size: 11, font: helvetica });
  y -= 16;

  page.drawText(`• Payment expected by ${paymentDueDateStr}`, { x: leftMargin + 10, y, size: 11, font: helvetica });

  return pdfDoc.save();
}

/**
 * Generate Hours Log PDF using pdf-lib
 */
async function generateHoursLogPdf(invoiceDate: Dayjs, weeks: WeekGroup): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]);
  let { height } = page.getSize();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const monthYear = invoiceDate.format("MMMM YYYY");

  let y = height - 50;
  const leftMargin = 50;
  const rightMargin = 562;

  // Header
  page.drawText(`PG&E ${monthYear} Hours Log`, { x: leftMargin, y, size: 20, font: helveticaBold });
  y -= 30;

  const sortedWeeks = Object.keys(weeks)
    .map(Number)
    .sort((a, b) => a - b);

  let totalHours = 0;

  for (const weekNum of sortedWeeks) {
    const weekEntries = weeks[weekNum];

    // Check if we need a new page
    if (y < 100) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }

    // Week header
    page.drawText(`Week ${weekNum}`, {
      x: leftMargin,
      y,
      size: 16,
      font: helveticaBold,
    });
    // Underline
    const weekHeaderWidth = helveticaBold.widthOfTextAtSize(`Week ${weekNum}`, 16);
    page.drawLine({
      start: { x: leftMargin, y: y - 2 },
      end: { x: leftMargin + weekHeaderWidth, y: y - 2 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    y -= 25;

    // Sort entries by date
    const sortedEntries = [...weekEntries].sort((a, b) => a.date.valueOf() - b.date.valueOf());

    for (const entry of sortedEntries) {
      // Check if we need a new page
      if (y < 80) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 50;
      }

      totalHours += entry.hours;
      const dateStr = entry.date.format("dddd, MMMM D, YYYY");

      // Date header
      page.drawText(dateStr, {
        x: leftMargin,
        y,
        size: 13,
        font: helveticaBold,
      });
      // Underline
      const dateWidth = helveticaBold.widthOfTextAtSize(dateStr, 13);
      page.drawLine({
        start: { x: leftMargin, y: y - 2 },
        end: { x: leftMargin + dateWidth, y: y - 2 },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });
      y -= 18;

      // Hours
      page.drawText("Total Hours: ", { x: leftMargin, y, size: 11, font: helveticaBold });
      const hoursLabelWidth = helveticaBold.widthOfTextAtSize("Total Hours: ", 11);
      page.drawText(`${entry.hours}`, { x: leftMargin + hoursLabelWidth, y, size: 11, font: helvetica });
      y -= 16;

      // Description
      page.drawText("Description: ", { x: leftMargin, y, size: 11, font: helveticaOblique });
      const descLabelWidth = helveticaOblique.widthOfTextAtSize("Description: ", 11);

      // Handle long descriptions by wrapping
      const maxDescWidth = rightMargin - leftMargin - descLabelWidth;
      let descText = entry.description;
      let descX = leftMargin + descLabelWidth;

      // Simple word wrap
      const words = descText.split(" ");
      let currentLine = "";
      let firstLine = true;

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = helvetica.widthOfTextAtSize(testLine, 11);

        if (testWidth > maxDescWidth && currentLine) {
          page.drawText(currentLine, { x: descX, y, size: 11, font: helvetica });
          y -= 14;
          currentLine = word;
          if (firstLine) {
            descX = leftMargin;
            firstLine = false;
          }
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        page.drawText(currentLine, { x: descX, y, size: 11, font: helvetica });
        y -= 20;
      }
    }

    y -= 10;
  }

  // Divider
  y -= 10;
  page.drawLine({
    start: { x: leftMargin, y },
    end: { x: rightMargin, y },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  y -= 20;

  // Total hours
  page.drawText(`Total Hours for ${monthYear}: ${totalHours}`, {
    x: leftMargin,
    y,
    size: 12,
    font: helveticaBold,
  });

  return pdfDoc.save();
}

const errorHeaders: Record<string, string> = {
  "Content-Type": "text/plain",
  "Access-Control-Allow-Origin": "*",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: errorHeaders,
      body: "Method not allowed",
    };
  }

  const docType = event.queryStringParameters?.type;

  if (docType !== "invoice" && docType !== "hours-log") {
    return {
      statusCode: 400,
      headers: errorHeaders,
      body: "Invalid type parameter. Use ?type=invoice or ?type=hours-log",
    };
  }

  try {
    const invoiceDate = getInvoiceDate();
    const monthYear = invoiceDate.format("MMMM YYYY");

    const firstOfMonth = invoiceDate.startOf("month");
    const lastOfMonth = invoiceDate.endOf("month");
    const firstOfMonthStr = firstOfMonth.format("YYYY-MM-DD");
    const lastOfMonthStr = lastOfMonth.format("YYYY-MM-DD");

    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (database as { data_sources?: Array<{ id: string }> }).data_sources?.[0]?.id;

    if (!dataSourceId) {
      throw new Error("Could not find data source for database");
    }

    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          {
            property: "Date",
            date: {
              on_or_after: firstOfMonthStr,
            },
          },
          {
            property: "Date",
            date: {
              on_or_before: lastOfMonthStr,
            },
          },
        ],
      },
      sorts: [
        {
          property: "Date",
          direction: "ascending",
        },
      ],
    });

    const entries: TimeEntry[] = [];

    for (const page of response.results) {
      if (!("properties" in page)) continue;

      const properties = page.properties as {
        Date?: { date?: { start?: string } };
        Hours?: { number?: number };
        Description?: { title?: Array<{ plain_text?: string }> };
      };

      const dateStr = properties.Date?.date?.start || "";
      const hours = properties.Hours?.number || 0;
      const description = properties.Description?.title?.[0]?.plain_text || "";

      if (dateStr) {
        entries.push({
          date: dayjs(dateStr),
          hours,
          description,
        });
      }
    }

    const weeks = groupEntriesByWeek(entries, monthYear);

    if (Object.keys(weeks).length === 0) {
      return {
        statusCode: 404,
        headers: errorHeaders,
        body: `No entries found for ${monthYear}`,
      };
    }

    let pdfBytes: Uint8Array;
    let filename: string;

    if (docType === "invoice") {
      pdfBytes = await generateInvoicePdf(invoiceDate, weeks);
      filename = `${CLIENT_NAME} ${monthYear} Invoice.pdf`;
    } else {
      pdfBytes = await generateHoursLogPdf(invoiceDate, weeks);
      filename = `PG&E ${monthYear} Hours Log.pdf`;
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Access-Control-Allow-Origin": "*",
      },
      body: Buffer.from(pdfBytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("Error generating document:", error);
    return {
      statusCode: 500,
      headers: errorHeaders,
      body: "Failed to generate document",
    };
  }
};
