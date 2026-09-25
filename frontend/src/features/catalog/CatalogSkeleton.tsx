// Shown only on a true cold start (no cached menu at all). Same masthead + grid geometry as the
// real catalog so the layout does not jump when the menu arrives. Deliberately NOT .product-card,
// so nothing can mistake a placeholder for a real product.
export function CatalogSkeleton({ branchName }: { branchName: string }) {
  return (
    <>
      <div className="px-4 pt-2">
        <div className="flex min-h-11 items-center justify-between">
          <span className="font-display text-[20px] font-semibold tracking-[0.32em] after:ml-1 after:inline-block after:size-1.5 after:rounded-full after:bg-terracotta after:content-['']">CUP</span>
        </div>
        <div className="flex min-h-11 max-w-full cursor-pointer items-baseline gap-2 text-left">
          <span className="min-w-0 overflow-hidden text-small font-semibold text-ellipsis whitespace-nowrap text-muted">{branchName}</span>
        </div>
        <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em] mt-3">Bugun qanday coffee?</h1>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-x-3 gap-y-4 px-4 py-6" aria-busy="true" aria-label="Menyu yuklanmoqda">
        {[0, 1, 2, 3].map((n) => (
          <div className="overflow-hidden rounded-md border border-line" key={n}>
            <div className="aspect-[4/3] bg-cream-soft animate-pulse-soft bg-skeleton" />
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3 rounded-[6px] animate-pulse-soft bg-skeleton" />
              <div className="h-3 w-[45%] animate-pulse-soft rounded-[6px] bg-skeleton" />
              <div className="mt-1 h-11 rounded-sm animate-pulse-soft bg-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
