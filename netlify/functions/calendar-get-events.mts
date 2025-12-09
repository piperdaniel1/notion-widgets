import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import isoWeek from "dayjs/plugin/isoWeek.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const MST = "America/Denver";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_CALENDER_DB_ID!;

interface CalendarEvent {
  id: string;
  name: string;
  time: string;
  datetime: string;
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
    const dayParam = event.queryStringParameters?.day;
    if (!dayParam) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Missing day parameter (1-7, Monday-Sunday)" }),
      };
    }

    const dayOfWeek = parseInt(dayParam, 10);
    if (isNaN(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Day must be 1-7 (Monday-Sunday)" }),
      };
    }

    // Get the date for this day of the current week
    const now = dayjs().tz(MST);
    const targetDate = now.isoWeekday(dayOfWeek);

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
              on_or_after: targetDate.format("YYYY-MM-DD"),
            },
          },
          {
            property: "Date",
            date: {
              before: targetDate.add(1, "day").format("YYYY-MM-DD"),
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

    const events: CalendarEvent[] = [];

    for (const page of response.results) {
      if (!("properties" in page)) continue;

      const properties = page.properties as {
        Date?: { date?: { start?: string } };
        Name?: { title?: Array<{ plain_text?: string }> };
      };

      const datetime = properties.Date?.date?.start || "";
      const name = properties.Name?.title?.[0]?.plain_text || "";
      const pageId = page.id.replace(/-/g, "");

      // Parse time from datetime
      let time = "";
      if (datetime.includes("T")) {
        const eventTime = dayjs(datetime).tz(MST);
        time = eventTime.format("h:mm A");
      }

      events.push({
        id: pageId,
        name,
        time,
        datetime,
      });
    }

    // Sort by time (events with time first, then by time ascending)
    events.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return dayjs(a.datetime).valueOf() - dayjs(b.datetime).valueOf();
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        date: targetDate.format("YYYY-MM-DD"),
        day: dayOfWeek,
        events,
        databaseId: databaseId.replace(/-/g, ""),
      }),
    };
  } catch (error) {
    console.error("Error fetching calendar events:", error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Failed to fetch calendar events" }),
    };
  }
};
