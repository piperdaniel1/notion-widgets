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

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        ...jsonHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const name = body.name || "";
    const time = body.time || "";
    const day = parseInt(body.day, 10);

    if (!name || isNaN(day) || day < 1 || day > 7) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Missing required fields (name, day 1-7)" }),
      };
    }

    // Get the date for this day of the current week
    const now = dayjs().tz(MST);
    const targetDate = now.isoWeekday(day);
    const dateStr = targetDate.format("YYYY-MM-DD");

    // Combine date and time into ISO datetime
    let dateTimeStart: string;
    if (time) {
      // time is in HH:mm format from the time input
      const combined = dayjs.tz(`${dateStr} ${time}`, "YYYY-MM-DD HH:mm", MST);
      dateTimeStart = combined.toISOString();
    } else {
      dateTimeStart = dateStr;
    }

    const createdPage = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        Name: {
          title: [{ text: { content: name } }],
        },
        Date: {
          date: { start: dateTimeStart },
        },
      },
    });

    const pageId = createdPage.id.replace(/-/g, "");

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ success: true, pageId }),
    };
  } catch (error) {
    console.error("Error adding calendar event:", error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Failed to add event" }),
    };
  }
};
