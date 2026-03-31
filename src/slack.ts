import { WebClient } from "@slack/web-api";

export interface BugReport {
  reporter: string;
  date: string;
  content: string;
  status: string;
  thread_ts: string;
}

export interface BugDetail {
  reporter: string;
  description: string;
  screenshots: string[];
  status: string;
  replies: Array<{ user: string; text: string; ts: string }>;
}

export interface ListItem {
  id: string;
  list_id: string;
  date_created: string;
  fields: Record<string, string>;
  raw_fields: any[];
}

export interface SlackQAConfig {
  token: string;
  channelId: string;
  listId?: string;
}

export class SlackQAClient {
  private client: WebClient;
  private channelId: string;
  private listId: string;

  constructor(config?: Partial<SlackQAConfig>) {
    const token = config?.token ?? process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is required");
    this.client = new WebClient(token);
    this.channelId = config?.channelId ?? process.env.SLACK_QA_CHANNEL_ID ?? "";
    this.listId = config?.listId ?? process.env.SLACK_LIST_ID ?? "";
  }

  // ── Slack Lists API (slackLists.*) ──

  async listItems(listId?: string, statusFilter?: string): Promise<ListItem[]> {
    const id = listId ?? this.listId;
    if (!id) throw new Error("SLACK_LIST_ID is required. Set it in env or pass as argument.");

    try {
      const result: any = await this.client.apiCall("slackLists.items.list", {
        list_id: id,
      });

      const items: ListItem[] = (result.items ?? []).map((item: any) =>
        this.parseListItem(item)
      );

      if (statusFilter) {
        return items.filter((item) => {
          const vals = Object.values(item.fields).join(" ").toLowerCase();
          return vals.includes(statusFilter.toLowerCase());
        });
      }
      return items;
    } catch (err: any) {
      if (err?.data?.error === "missing_scope" || err?.data?.error === "not_allowed_token_type") {
        console.error("Lists API unavailable, falling back to channel scan:", err.data?.error);
        return this.listItemsFallback(statusFilter);
      }
      throw new Error(`slackLists.items.list failed: ${err?.data?.error ?? err}`);
    }
  }

  async getListItem(itemId: string, listId?: string): Promise<ListItem> {
    const id = listId ?? this.listId;
    if (!id) throw new Error("SLACK_LIST_ID is required.");
    const result: any = await this.client.apiCall("slackLists.items.info", {
      list_id: id,
      item_id: itemId,
    });
    return this.parseListItem(result.item);
  }

  async updateItemStatus(
    itemId: string,
    statusFieldKey: string,
    statusValue: string,
    note?: string
  ): Promise<{ ok: boolean; message: string }> {
    if (!this.listId) return this.updateItemFallback(itemId, statusValue, note);

    try {
      await this.client.apiCall("slackLists.items.update", {
        list_id: this.listId,
        item_id: itemId,
        fields: [{ key: statusFieldKey, value: statusValue }],
      });

      if (note && this.channelId) {
        await this.postFixUpdate(`상태 업데이트: *${statusValue}*\n${note}`);
      }
      return { ok: true, message: `Item ${itemId} → "${statusValue}"` };
    } catch (err: any) {
      if (err?.data?.error === "missing_scope" || err?.data?.error === "not_allowed_token_type") {
        return this.updateItemFallback(itemId, statusValue, note);
      }
      throw new Error(`slackLists.items.update failed: ${err?.data?.error ?? err}`);
    }
  }

  // ── Channel-based operations ──

  async scanBugs(daysBack: number = 7): Promise<BugReport[]> {
    if (!this.channelId) throw new Error("SLACK_QA_CHANNEL_ID is required.");

    const oldest = String(Math.floor(Date.now() / 1000) - daysBack * 86400);
    const result = await this.client.conversations.history({
      channel: this.channelId,
      oldest,
      limit: 200,
    });

    const bugs: BugReport[] = [];
    for (const msg of result.messages ?? []) {
      const text = msg.text ?? "";
      if (!text && !msg.blocks) continue;
      if (msg.subtype === "channel_join" || msg.subtype === "channel_leave") continue;

      const reporter = await this.resolveUser(msg.user ?? msg.bot_id ?? "unknown");
      const date = msg.ts
        ? new Date(parseFloat(msg.ts) * 1000).toISOString()
        : "";

      let status = "open";
      if (msg.reactions) {
        const names = msg.reactions.map((r) => r.name);
        if (names.includes("white_check_mark") || names.includes("heavy_check_mark")) {
          status = "resolved";
        } else if (names.includes("eyes")) {
          status = "in_progress";
        }
      }

      bugs.push({ reporter, date, content: this.extractContent(msg), status, thread_ts: msg.ts ?? "" });
    }
    return bugs;
  }

  async getBugDetail(threadTs: string): Promise<BugDetail> {
    if (!this.channelId) throw new Error("SLACK_QA_CHANNEL_ID is required.");

    const history = await this.client.conversations.history({
      channel: this.channelId,
      latest: threadTs,
      inclusive: true,
      limit: 1,
    });

    const parent = history.messages?.[0];
    if (!parent) throw new Error("Message not found");

    const reporter = await this.resolveUser(parent.user ?? parent.bot_id ?? "unknown");
    const description = this.extractContent(parent);
    const screenshots = this.extractImages(parent);

    let status = "open";
    if (parent.reactions) {
      const names = parent.reactions.map((r) => r.name);
      if (names.includes("white_check_mark") || names.includes("heavy_check_mark")) status = "resolved";
      else if (names.includes("eyes")) status = "in_progress";
    }

    const replies: BugDetail["replies"] = [];
    try {
      const thread = await this.client.conversations.replies({ channel: this.channelId, ts: threadTs });
      for (const msg of (thread.messages ?? []).slice(1)) {
        replies.push({
          user: await this.resolveUser(msg.user ?? "unknown"),
          text: msg.text ?? "",
          ts: msg.ts ?? "",
        });
      }
    } catch {}

    return { reporter, description, screenshots, status, replies };
  }

  async postFixUpdate(
    message: string,
    threadTs?: string,
    prUrl?: string
  ): Promise<{ ok: boolean; permalink: string }> {
    if (!this.channelId) throw new Error("SLACK_QA_CHANNEL_ID is required.");

    let text = message;
    if (prUrl) text += `\n\nPR: ${prUrl}`;

    const result = await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: threadTs,
      text,
    });

    let permalink = "";
    if (result.ts) {
      try {
        const link = await this.client.chat.getPermalink({ channel: this.channelId, message_ts: result.ts });
        permalink = link.permalink ?? "";
      } catch {}
    }
    return { ok: !!result.ok, permalink };
  }

  // ── Fallbacks ──

  private async listItemsFallback(statusFilter?: string): Promise<ListItem[]> {
    if (!this.channelId) return [];
    const history = await this.client.conversations.history({ channel: this.channelId, limit: 100 });

    const items: ListItem[] = [];
    for (const msg of history.messages ?? []) {
      const text = msg.text ?? "";
      if (text.includes("qa") || text.includes("QA") || text.includes("버그") || text.includes("bug")) {
        let status = "open";
        if (msg.reactions) {
          const names = msg.reactions.map((r) => r.name);
          if (names.includes("white_check_mark")) status = "resolved";
          else if (names.includes("eyes")) status = "in_progress";
        }
        if (!statusFilter || status.includes(statusFilter.toLowerCase())) {
          items.push({
            id: msg.ts ?? "",
            list_id: this.listId,
            date_created: msg.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : "",
            fields: { content: text.slice(0, 200), status },
            raw_fields: [],
          });
        }
      }
    }
    return items;
  }

  private async updateItemFallback(
    itemId: string,
    status: string,
    note?: string
  ): Promise<{ ok: boolean; message: string }> {
    if (!this.channelId) throw new Error("SLACK_QA_CHANNEL_ID is required for fallback.");

    const emoji = status === "resolved" ? "white_check_mark"
      : status === "in_progress" ? "eyes" : "memo";

    await this.client.reactions.add({ channel: this.channelId, timestamp: itemId, name: emoji });

    if (note) {
      await this.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: itemId,
        text: `Status: *${status}*\n${note}`,
      });
    }
    return { ok: true, message: `Fallback: ${itemId} → ${status}` };
  }

  // ── Helpers ──

  private async resolveUser(userId: string): Promise<string> {
    try {
      const info = await this.client.users.info({ user: userId });
      return info.user?.real_name ?? info.user?.name ?? userId;
    } catch { return userId; }
  }

  private extractContent(msg: any): string {
    let content = msg.text ?? "";
    if (msg.blocks) {
      for (const block of msg.blocks) {
        if (block.type === "section" && block.text?.text && !content.includes(block.text.text)) {
          content += "\n" + block.text.text;
        }
        if (block.type === "rich_text") {
          for (const el of block.elements ?? []) {
            for (const item of el.elements ?? []) {
              if (item.type === "text" && !content.includes(item.text)) content += "\n" + item.text;
            }
          }
        }
      }
    }
    return content.trim();
  }

  private extractImages(msg: any): string[] {
    const images: string[] = [];
    if (msg.files) {
      for (const file of msg.files) {
        if (file.mimetype?.startsWith("image/")) images.push(file.url_private ?? file.permalink ?? "");
      }
    }
    return images.filter(Boolean);
  }

  private parseListItem(item: any): ListItem {
    const fields: Record<string, string> = {};
    for (const f of item.fields ?? []) {
      const key = f.key ?? f.column_id ?? "unknown";
      if (typeof f.value === "string") fields[key] = f.value;
      else if (typeof f.value === "boolean") fields[key] = String(f.value);
      else if (Array.isArray(f.value)) fields[key] = f.value.join(", ");
      else if (f.text) fields[key] = f.text;
      else if (f.rich_text) fields[key] = this.extractRichText(f.rich_text);
      else fields[key] = JSON.stringify(f.value ?? "");
    }
    return {
      id: item.id ?? "",
      list_id: item.list_id ?? "",
      date_created: item.date_created ?? "",
      fields,
      raw_fields: item.fields ?? [],
    };
  }

  private extractRichText(richText: any): string {
    let text = "";
    for (const block of richText.elements ?? richText.sections ?? [richText]) {
      for (const el of block.elements ?? []) {
        if (el.type === "text") text += el.text ?? "";
        else if (el.type === "link") text += el.url ?? "";
        else if (el.type === "user") text += `<@${el.user_id}>`;
      }
    }
    return text || JSON.stringify(richText);
  }
}
