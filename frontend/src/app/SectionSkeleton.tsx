// Section-level placeholder for the Account screen: a quiet neutral block, no spinners.
export function SectionSkeleton({ height = 96 }: { height?: number }) {
  return <div className="rounded-md animate-pulse-soft bg-skeleton" style={{ minHeight: height }} role="status" aria-label="Yuklanmoqda" />;
}
