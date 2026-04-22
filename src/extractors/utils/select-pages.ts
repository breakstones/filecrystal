function range(start: number, end: number): number[] {
  if (end < start) return [];
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export function selectPages(
  totalPages: number,
  ratio: [number, number] = [7, 3],
  max = 10,
): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= max) return range(1, totalPages);
  const [headRatio, tailRatio] = ratio;
  const head = Math.ceil((max * headRatio) / (headRatio + tailRatio));
  const tail = max - head;
  return [...range(1, head), ...range(totalPages - tail + 1, totalPages)];
}
