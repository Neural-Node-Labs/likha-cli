/**
 * Token Count Parser
 *
 * Parses a token usage string (e.g. from DeepSeek's output) into a structured
 * object with input, output, cached, and total token counts. Validates that the
 * parsed total matches the sum of input + output + cached, flagging any discrepancy.
 *
 * Expected input format:
 *   "3,592 in · 281 out · 2,944 cached — 3,873 total this run"
 *
 * The parser is lenient about whitespace, comma formatting, and the exact wording
 * around the numbers — it extracts the first four comma-formatted integers it finds
 * in order: input, output, cached, total.
 */

export interface ParsedTokenCounts {
  /** Number of input (prompt) tokens. */
  input: number;
  /** Number of output (completion) tokens. */
  output: number;
  /** Number of cached (context cache) tokens. */
  cached: number;
  /** Total tokens reported in the string. */
  total: number;
  /** Whether the parsed total matches input + output + cached. */
  discrepancy: boolean;
  /** The expected total if input + output + cached were summed. */
  expectedTotal: number;
}

/**
 * Parse a token usage string into structured counts.
 *
 * Extracts the first four comma-formatted integers from the input string,
 * interpreting them as input, output, cached, and total respectively.
 * Validates that total === input + output + cached and sets the discrepancy
 * flag accordingly.
 *
 * @param input - The raw token usage string (e.g. "3,592 in · 281 out · 2,944 cached — 3,873 total this run")
 * @returns ParsedTokenCounts with all fields populated
 * @throws {Error} If fewer than 4 numbers can be extracted from the string
 */
export function parseTokenCounts(input: string): ParsedTokenCounts {
  // Extract all comma-formatted or plain integers from the string
  // Matches numbers like 3592, 3,592, 2,944, etc.
  const numberPattern = /\b\d{1,3}(?:,\d{3})*\b|\b\d+\b/g;
  const matches = input.match(numberPattern);

  if (!matches || matches.length < 4) {
    throw new Error(
      `Unable to parse token counts from "${input}": expected at least 4 numbers, found ${matches?.length ?? 0}`
    );
  }

  // Strip commas and parse as integers
  const numbers = matches.map((m) => parseInt(m.replace(/,/g, ""), 10));

  const [parsedInput, parsedOutput, parsedCached, parsedTotal] = numbers;

  const expectedTotal = parsedInput + parsedOutput + parsedCached;
  const discrepancy = parsedTotal !== expectedTotal;

  return {
    input: parsedInput,
    output: parsedOutput,
    cached: parsedCached,
    total: parsedTotal,
    discrepancy,
    expectedTotal,
  };
}
