export interface TokenUsage {
  input: number;
  output: number;
}

export class TokenCounter {
  private usage: TokenUsage = { input: 0, output: 0 };

  add(inputTokens: number, outputTokens: number): void {
    this.usage.input += Math.max(0, inputTokens);
    this.usage.output += Math.max(0, outputTokens);
  }

  snapshot(): TokenUsage {
    return { ...this.usage };
  }
}
