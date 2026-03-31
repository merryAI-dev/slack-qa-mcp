import { z } from "zod";

export const ScanQaBugsInput = z.object({
  days_back: z.number().min(1).max(90).default(7).describe("조회할 기간 (일)"),
});

export const GetBugDetailInput = z.object({
  thread_ts: z.string().describe("버그 메시지의 thread_ts"),
});

export const ListItemsInput = z.object({
  list_id: z.string().optional().describe("Slack List ID (기본값: 피드백 추적기)"),
  status_filter: z.string().optional().describe("상태 필터 (예: open, resolved, in_progress)"),
});

export const UpdateItemStatusInput = z.object({
  item_id: z.string().describe("Item ID from the Slack List"),
  status_field_key: z.string().default("상태").describe("The field key/column name for status"),
  status: z.string().describe("New status value (e.g. open, in_progress, resolved)"),
  note: z.string().optional().describe("Optional note for the status change"),
});

export const PostFixUpdateInput = z.object({
  thread_ts: z.string().optional().describe("스레드에 답글로 달 경우 thread_ts"),
  message: z.string().describe("수정 내용 메시지"),
  pr_url: z.string().optional().describe("PR URL"),
});

export type ScanQaBugsArgs = z.infer<typeof ScanQaBugsInput>;
export type GetBugDetailArgs = z.infer<typeof GetBugDetailInput>;
export type ListItemsArgs = z.infer<typeof ListItemsInput>;
export type UpdateItemStatusArgs = z.infer<typeof UpdateItemStatusInput>;
export type PostFixUpdateArgs = z.infer<typeof PostFixUpdateInput>;
