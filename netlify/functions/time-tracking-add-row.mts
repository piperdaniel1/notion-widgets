import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed",
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const hours = parseFloat(body.hours) || 0;
    const date = body.date || "";
    const description = body.description || "";

    if (!hours || !date || !description) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields" }),
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
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Error adding row to Notion:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to add entry" }),
    };
  }
};
