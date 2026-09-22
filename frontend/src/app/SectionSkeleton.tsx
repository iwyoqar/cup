// Section-level placeholder for the Account screen: a quiet neutral block, no spinners.
export function SectionSkeleton({ height = 96 }: { height?: number }) {
  return <div className="section-skeleton skeleton-pulse" style={{ minHeight: height }} role="status" aria-label="Yuklanmoqda" />;
}
