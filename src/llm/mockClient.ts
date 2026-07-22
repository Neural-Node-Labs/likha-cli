import { LlmClient, LlmMessage, LlmResponse, ToolCall } from "../core/types.js";

/**
 * Scripted LlmClient for tests/dev: returns a pre-programmed sequence of responses so the
 * orchestrator's tool-dispatch loop can be verified without hitting a real API.
 */
export class MockLlmClient implements LlmClient {
  private callIndex = 0;
  public seenMessages: LlmMessage[][] = [];

  constructor(private script: LlmResponse[]) {}

  async complete(messages: LlmMessage[]): Promise<LlmResponse> {
    this.seenMessages.push(structuredClone(messages));
    const response = this.script[this.callIndex] ?? { content: "(no more scripted responses)", toolCalls: [] };
    this.callIndex += 1;
    return response;
  }
}

export function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}


