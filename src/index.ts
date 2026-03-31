#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { SlackQAClient } from "./slack.js";
import {
  ScanQaBugsInput,
  GetBugDetailInput,
  ListItemsInput,
  UpdateItemStatusInput,
  PostFixUpdateInput,
} from "./tools.js";

const server = new McpServer({
  name: "slack-qa-mcp",
  version: "0.1.0",
});

let slackClient: SlackQAClient;

function getSlack(): SlackQAClient {
  if (!slackClient) {
    slackClient = new SlackQAClient();
  }
  return slackClient;
}

// --- Tool registrations ---

server.tool(
  "scan_qa_bugs",
  "Scan #axr-qa channel for recent QA bug reports (버그 리포트 스캔)",
  ScanQaBugsInput.shape,
  async ({ days_back }) => {
    try {
      const bugs = await getSlack().scanBugs(days_back);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(bugs, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_bug_detail",
  "Get detailed info on a specific bug thread (버그 상세 조회)",
  GetBugDetailInput.shape,
  async ({ thread_ts }) => {
    try {
      const detail = await getSlack().getBugDetail(thread_ts);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_items",
  "Read items from the QA Slack List - 피드백 추적기",
  ListItemsInput.shape,
  async ({ list_id, status_filter }) => {
    try {
      const items = await getSlack().listItems(list_id, status_filter);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(items, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "update_item_status",
  "Update a QA item's status (상태 업데이트)",
  UpdateItemStatusInput.shape,
  async ({ item_id, status_field_key, status, note }) => {
    try {
      const result = await getSlack().updateItemStatus(item_id, status_field_key, status, note);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "post_fix_update",
  "Post a fix update to #axr-qa channel (수정 내용 공유)",
  PostFixUpdateInput.shape,
  async ({ thread_ts, message, pr_url }) => {
    try {
      const result = await getSlack().postFixUpdate(message, thread_ts, pr_url);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  }
);

// --- Transport ---

const transportArg = process.argv.includes("--transport")
  ? process.argv[process.argv.indexOf("--transport") + 1]
  : "stdio";

async function main() {
  if (transportArg === "sse") {
    const app = express();
    const PORT = parseInt(process.env.PORT ?? "3001", 10);

    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).send("Session not found");
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(PORT, () => {
      console.error(`axr-qa-mcp SSE server running on port ${PORT}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("axr-qa-mcp server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
