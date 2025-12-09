import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;

function getTodayInMST(): string {
  const now = new Date();
  const mstOffset = -7;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const mstDate = new Date(utc + 3600000 * mstOffset);
  return mstDate.toISOString().split("T")[0];
}

interface TimeEntry {
  date?: string;
  hours: number;
  description: string;
  notes?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body: TimeEntry = JSON.parse(event.body || "{}");

    if (!body.hours || !body.description) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "hours and description are required" }),
      };
    }

    const date = body.date || getTodayInMST();

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        Date: {
          date: {
            start: date,
          },
        },
        Hours: {
          number: body.hours,
        },
        Description: {
          title: [
            {
              text: {
                content: body.description,
              },
            },
          ],
        },
        ...(body.notes && {
          Notes: {
            rich_text: [
              {
                text: {
                  content: body.notes,
                },
              },
            ],
          },
        }),
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: response.id }),
    };
  } catch (error) {
    console.error("Error adding row to Notion:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to add row to Notion" }),
    };
  }
};
