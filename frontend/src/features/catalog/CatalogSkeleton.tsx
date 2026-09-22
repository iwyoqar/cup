// Shown only on a true cold start (no cached menu at all). Same masthead + grid geometry as the
// real catalog so the layout does not jump when the menu arrives. Deliberately NOT .product-card,
// so nothing can mistake a placeholder for a real product.
export function CatalogSkeleton({ branchName }: { branchName: string }) {
  return (
    <>
      <div className="masthead">
        <div className="masthead__bar">
          <span className="brand-mark">CUP</span>
        </div>
        <div className="branch-line">
          <span className="branch-line__name">{branchName}</span>
        </div>
        <h1 className="display masthead__title">Bugun qanday coffee?</h1>
      </div>
      <div className="product-list" aria-busy="true" aria-label="Menyu yuklanmoqda">
        {[0, 1, 2, 3].map((n) => (
          <div className="product-skeleton" key={n}>
            <div className="product-skeleton__image skeleton-pulse" />
            <div className="product-skeleton__body">
              <div className="product-skeleton__line skeleton-pulse" />
              <div className="product-skeleton__line product-skeleton__line--short skeleton-pulse" />
              <div className="product-skeleton__button skeleton-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
