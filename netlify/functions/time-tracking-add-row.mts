import { Client } from "@notionhq/client";
import type { Handler } from "@netlify/functions";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_TIME_TRACKING_DB_ID!;

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const hours = parseFloat(body.hours) || 0;
    const date = body.date || "";
    const description = body.description || "";
    const notes = body.notes || "";
    const entryId = body.entryId || null;

    if (!hours || !date || !description) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    const properties: any = {
      Date: {
        date: { start: date },
      },
      Hours: {
        number: hours,
      },
      Description: {
        title: [{ text: { content: description } }],
      },
    };

    if (notes) {
      properties.Notes = {
        rich_text: [{ text: { content: notes } }],
      };
    } else {
      // Clear notes if not provided during update
      properties.Notes = {
        rich_text: [],
      };
    }

    // If entryId is provided, update existing entry
    if (entryId) {
      await notion.pages.update({
        page_id: entryId,
        properties,
      });

      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // Otherwise, check if entry exists for this date (enforce one entry per day)
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (database as { data_sources?: Array<{ id: string }> }).data_sources?.[0]?.id;

    if (!dataSourceId) {
      throw new Error("Could not find data source for database");
    }

    // Query for existing entry on this date
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: "Date",
        date: {
          equals: date,
        },
      },
    });

    // If entry exists for this date, reject with 409 Conflict
    if (response.results.length > 0) {
      return {
        statusCode: 409,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "An entry already exists for this date" }),
      };
    }

    // Create new entry
    await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Error adding/updating row in Notion:", error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Failed to add/update entry" }),
    };
  }
};
