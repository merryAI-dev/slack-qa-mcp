# slack-qa-mcp

Slack 채널과 Slack Lists를 연동하는 QA 버그 관리 MCP 서버.
채널에서 버그 리포트를 스캔하고, Slack Lists 항목을 조회/업데이트하며, 수정 내용을 공유합니다.

## Tools

| Tool | Description |
|------|-------------|
| `scan_qa_bugs` | Scan a Slack channel for recent bug reports |
| `get_bug_detail` | Get thread details for a specific bug |
| `list_items` | Read items from a Slack List (slackLists API) |
| `update_item_status` | Update a List item's status field |
| `post_fix_update` | Post a fix update message to the channel |

## Setup

```bash
npm install && npm run build
```

Copy `.env.example` to `.env` and fill in:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_QA_CHANNEL_ID=C...
SLACK_LIST_ID=F...          # optional
```

## Required Slack App Scopes

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read channel messages |
| `channels:read` | Channel info |
| `chat:write` | Post messages |
| `reactions:read` | Read reactions |
| `reactions:write` | Add reactions |
| `users:read` | Resolve user names |
| `lists:read` | Read Slack Lists |
| `lists:write` | Update Slack Lists |

## Run

```bash
# stdio (for MCP clients like Claude Desktop/Code)
npm start

# SSE (for remote deployment)
node dist/index.js --transport sse
# → http://localhost:3001/sse
```

## MCP Client Config

```json
{
  "mcpServers": {
    "slack-qa": {
      "command": "node",
      "args": ["<path>/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-...",
        "SLACK_QA_CHANNEL_ID": "C...",
        "SLACK_LIST_ID": "F..."
      }
    }
  }
}
```

## Deploy (Docker)

```bash
npm run build
docker build -t slack-qa-mcp .
docker run -e SLACK_BOT_TOKEN=xoxb-... -e SLACK_QA_CHANNEL_ID=C... -p 3001:3001 slack-qa-mcp --transport sse
```
