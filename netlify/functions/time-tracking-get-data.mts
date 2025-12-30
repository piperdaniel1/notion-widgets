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
}

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const today = dayjs().tz(MST);
    const todayStr = today.format("YYYY-MM-DD");

    // First day of current month in MST
    const firstOfMonthStr = today.startOf("month").format("YYYY-MM-DD");

    // In SDK v5 / API 2025-09-03, databases and data sources are separate.
    // We need to get the database first to find its data source ID.
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (database as { data_sources?: Array<{ id: string }> }).data_sources?.[0]?.id;

    if (!dataSourceId) {
      throw new Error("Could not find data source for database");
    }

    // Query for all entries this month
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: "Date",
        date: {
          on_or_after: firstOfMonthStr,
        },
      },
      sorts: [
        {
          property: "Date",
          direction: "descending",
        },
      ],
    });

    const entries: TimeEntry[] = [];
    let todayTotalHours = 0;
    let monthTotalHours = 0;
    let todayEntryId: string | null = null;
    let todayEntry: { hours: number; description: string; notes: string } | null = null;

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

      entries.push({ date, hours, description });
      monthTotalHours += hours;

      if (date === todayStr) {
        todayTotalHours += hours;
        // Store the first entry for today (should only be one per day)
        if (!todayEntryId) {
          todayEntryId = page.id;
          todayEntry = { hours, description, notes };
        }
      }
    }

    const todayEntries = entries.filter((e) => e.date === todayStr);

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        today: todayStr,
        todayEntries,
        todayTotalHours,
        monthTotalHours,
        monthName: today.format("MMMM"),
        todayEntryId,
        todayEntry,
      }),
    };
  } catch (error) {
    console.error("Error fetching time tracking data:", error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Failed to fetch time tracking data" }),
    };
  }
};
