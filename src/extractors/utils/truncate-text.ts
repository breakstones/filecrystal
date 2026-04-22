export interface TruncatedText {
  text: string;
  truncated: boolean;
  originalLength: number;
  headCount: number;
  tailCount: number;
}

export function truncateText(
  text: string,
  maxChars = 5000,
  headCount = 3500,
  tailCount = 1500,
): TruncatedText {
  const originalLength = text.length;
  if (originalLength <= maxChars) {
    return { text, truncated: false, originalLength, headCount: originalLength, tailCount: 0 };
  }
  const head = text.slice(0, headCount);
  const tail = text.slice(originalLength - tailCount);
  return {
    text: `${head}\n\n[... truncated ${originalLength - headCount - tailCount} chars ...]\n\n${tail}`,
    truncated: true,
    originalLength,
    headCount,
    tailCount,
  };
}
