import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const MST = "America/Denver";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;

interface TimeEntry {
  date: string;
  hours: number;
  description: string;
  notes: string;
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Escape CSV field - wrap in quotes if contains comma, quote, or newline
function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    // Escape quotes by doubling them
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// Format date as M/D/YYYY
function formatDate(dateStr: string): string {
  const date = dayjs(dateStr);
  return `${date.month() + 1}/${date.date()}/${date.year()}`;
}

// Get day of week name
function getDayOfWeek(dateStr: string): string {
  const date = dayjs(dateStr);
  return DAYS_OF_WEEK[date.day()];
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
      body: "Method not allowed",
    };
  }

  try {
    const now = dayjs().tz(MST);
    const dayOfMonth = now.date();

    // Determine which month to export
    // Days 1-15: export previous month
    // Days 16-31: export current month
    let targetMonth = now;
    if (dayOfMonth <= 15) {
      targetMonth = now.subtract(1, "month");
    }

    const firstOfMonth = targetMonth.startOf("month");
    const lastOfMonth = targetMonth.endOf("month");
    const firstOfMonthStr = firstOfMonth.format("YYYY-MM-DD");
    const lastOfMonthStr = lastOfMonth.format("YYYY-MM-DD");

    // Get database and data source
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (database as { data_sources?: Array<{ id: string }> }).data_sources?.[0]?.id;

    if (!dataSourceId) {
      throw new Error("Could not find data source for database");
    }

    // Query for entries in the target month
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
        Notes?: { rich_text?: Array<{ plain_text?: string }> };
      };

      const date = properties.Date?.date?.start || "";
      const hours = properties.Hours?.number || 0;
      const description = properties.Description?.title?.[0]?.plain_text || "";
      const notes = properties.Notes?.rich_text?.[0]?.plain_text || "";

      if (date) {
        entries.push({ date, hours, description, notes });
      }
    }

    // Generate CSV
    const csvLines: string[] = [];
    csvLines.push("Date,Day of Week,Hours,Description,Notes");

    for (const entry of entries) {
      const dateFormatted = formatDate(entry.date);
      const dayOfWeek = getDayOfWeek(entry.date);
      const hours = entry.hours.toString();
      const description = escapeCsvField(entry.description);
      const notes = escapeCsvField(entry.notes);

      csvLines.push(`${dateFormatted},${dayOfWeek},${hours},${description},${notes}`);
    }

    const csvContent = csvLines.join("\n");

    // Generate filename with month name
    const filename = `time-tracking-${targetMonth.format("YYYY-MM")}.csv`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Access-Control-Allow-Origin": "*",
      },
      body: csvContent,
    };
  } catch (error) {
    console.error("Error exporting time tracking data:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
      body: "Failed to export time tracking data",
    };
  }
};
