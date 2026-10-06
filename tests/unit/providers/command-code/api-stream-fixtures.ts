import type { HttpResponse } from "../../../../src/core/http"

export function sseResponse(events: readonly unknown[]): HttpResponse {
  return {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    ),
  }
}

// Synthetic events follow the installed OpenAI chat/responses and Anthropic chunk schemas.
export const textStreams = [
  {
    route: "chat/completions",
    events: [
      { choices: [{ index: 0, delta: { role: "assistant", content: "wire-" } }] },
      { choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
    ],
  },
  {
    route: "messages",
    events: [
      {
        type: "message_start",
        message: {
          id: "msg_fixture",
          model: "fixture-model",
          role: "assistant",
          content: [],
          usage: { input_tokens: 4, output_tokens: 0 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "wire-" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ],
  },
  {
    route: "responses",
    events: [
      {
        type: "response.created",
        response: { id: "resp_fixture", created_at: 1700000000, model: "fixture-model" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_fixture" },
      },
      { type: "response.output_text.delta", item_id: "msg_fixture", delta: "wire-" },
      { type: "response.output_text.delta", item_id: "msg_fixture", delta: "ok" },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "message", id: "msg_fixture" },
      },
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 4,
            output_tokens: 2,
            total_tokens: 6,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ],
  },
] as const

export const chatToolEvents = [
  {
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_next",
              type: "function",
              function: { name: "lookup", arguments: '{"key":' },
            },
          ],
        },
      },
    ],
  },
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '"next"}' },
            },
          ],
        },
      },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } },
] as const
