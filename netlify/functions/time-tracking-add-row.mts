import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;
const widgetPath = "/widgets/add-time-widget/";

export const handler: Handler = async (event) => {
  console.log("process.env.NOTION_API_KEY", process.env.NOTION_API_KEY);
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed",
    };
  }

  try {
    const params = new URLSearchParams(event.body || "");
    const hours = parseFloat(params.get("hours") || "");
    const date = params.get("date") || "";
    const description = params.get("description") || "";

    if (!hours || !date || !description) {
      return {
        statusCode: 302,
        headers: { Location: `${widgetPath}?error=missing-fields` },
        body: "",
      };
    }

    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        Date: {
          date: { start: date },
        },
        Hours: {
          number: hours,
        },
        Description: {
          title: [{ text: { content: description } }],
        },
      },
    });

    return {
      statusCode: 302,
      headers: { Location: `${widgetPath}?success=1` },
      body: "",
    };
  } catch (error) {
    console.error("Error adding row to Notion:", error);
    return {
      statusCode: 302,
      headers: { Location: `${widgetPath}?error=server` },
      body: "",
    };
  }
};
