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
  dayOfWeek: string;
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
        body: JSON.stringify({ error: "Missing day parameter (1-7, Monday-Sunday, comma-separated)" }),
      };
    }

    // Parse comma-separated days
    const days = dayParam.split(",").map((d) => parseInt(d.trim(), 10));
    for (const day of days) {
      if (isNaN(day) || day < 1 || day > 7) {
        return {
          statusCode: 400,
          headers: jsonHeaders,
          body: JSON.stringify({ error: "Days must be 1-7 (Monday-Sunday)" }),
        };
      }
    }

    // Get the dates for these days, rolling to next week only if ALL days have passed
    const now = dayjs().tz(MST);
    const currentDayOfWeek = now.isoWeekday();
    // If any day in the group is today or later, keep all days this week
    const anyDayNotPassed = days.some((d) => d >= currentDayOfWeek);
    const targetDates = days.map((d) => {
      let target = now.isoWeekday(d);
      // Only roll forward if ALL days have passed
      if (!anyDayNotPassed) {
        target = target.add(1, "week");
      }
      return target;
    });

    // Find the min and max dates for the query range
    const minDate = targetDates.reduce((min, d) => (d.isBefore(min) ? d : min), targetDates[0]);
    const maxDate = targetDates.reduce((max, d) => (d.isAfter(max) ? d : max), targetDates[0]);

    // Use full ISO timestamps with timezone to fix UTC boundary issues
    // Start of first day in MST, end of last day in MST
    const rangeStart = minDate.startOf("day").format();
    const rangeEnd = maxDate.add(1, "day").startOf("day").format();

    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (database as { data_sources?: Array<{ id: string }> }).data_sources?.[0]?.id;

    if (!dataSourceId) {
      throw new Error("Could not find data source for database");
    }

    // Query events that could overlap with our target dates
    // This includes: events starting in range, OR events that started before but end in/after range
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        or: [
          // Events starting within our range
          {
            and: [
              {
                property: "Date",
                date: {
                  on_or_after: rangeStart,
                },
              },
              {
                property: "Date",
                date: {
                  before: rangeEnd,
                },
              },
            ],
          },
          // Multi-day events that started before but might overlap
          {
            and: [
              {
                property: "Date",
                date: {
                  on_or_before: rangeStart,
                },
              },
              {
                property: "Date",
                date: {
                  on_or_after: minDate.subtract(30, "day").format(), // Look back up to 30 days for long events
                },
              },
            ],
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

    // Create a set of target date strings for filtering
    const targetDateStrings = new Set(targetDates.map((d) => d.format("YYYY-MM-DD")));

    const events: CalendarEvent[] = [];

    for (const page of response.results) {
      if (!("properties" in page)) continue;

      const properties = page.properties as {
        Date?: { date?: { start?: string; end?: string | null } };
        Name?: { title?: Array<{ plain_text?: string }> };
      };

      const startDatetime = properties.Date?.date?.start || "";
      const endDatetime = properties.Date?.date?.end || null;
      const name = properties.Name?.title?.[0]?.plain_text || "";
      const pageId = page.id.replace(/-/g, "");

      // Parse the event start datetime in MST
      const startInMST = startDatetime.includes("T")
        ? dayjs(startDatetime).tz(MST)
        : dayjs.tz(startDatetime, MST);
      const startDateStr = startInMST.format("YYYY-MM-DD");

      // Parse end date if it exists (for multi-day events)
      const endInMST = endDatetime
        ? endDatetime.includes("T")
          ? dayjs(endDatetime).tz(MST)
          : dayjs.tz(endDatetime, MST)
        : null;

      // Check if any target date falls within this event's range
      let matchesTargetDate = false;
      if (endInMST) {
        // Multi-day event: check if any target date is within [start, end]
        for (const targetDateStr of targetDateStrings) {
          const target = dayjs.tz(targetDateStr, MST);
          if (
            (target.isSame(startInMST, "day") || target.isAfter(startInMST, "day")) &&
            (target.isSame(endInMST, "day") || target.isBefore(endInMST, "day"))
          ) {
            matchesTargetDate = true;
            break;
          }
        }
      } else {
        // Single-day event: check if start date matches any target
        matchesTargetDate = targetDateStrings.has(startDateStr);
      }

      if (!matchesTargetDate) {
        continue;
      }

      // Parse time from datetime - show "All Day" for date-only events
      let time = "All Day";
      if (startDatetime.includes("T")) {
        time = startInMST.format("h:mm A");
      }

      // Get day of week abbreviation (e.g., "SAT", "SUN")
      const dayOfWeek = startInMST.format("ddd").toUpperCase();

      events.push({
        id: pageId,
        name,
        time,
        dayOfWeek,
        datetime: startDatetime,
      });
    }

    // Sort by time (All Day events first, then by time ascending)
    events.sort((a, b) => {
      const aIsAllDay = a.time === "All Day";
      const bIsAllDay = b.time === "All Day";
      if (aIsAllDay && bIsAllDay) return 0;
      if (aIsAllDay) return -1;
      if (bIsAllDay) return 1;
      return dayjs(a.datetime).valueOf() - dayjs(b.datetime).valueOf();
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        dates: targetDates.map((d) => d.format("YYYY-MM-DD")),
        days,
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
