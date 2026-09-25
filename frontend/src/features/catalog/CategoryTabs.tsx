import { Category } from '../../types/api';
import { cx } from '../../lib/cx';

interface CategoryTabsProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}

// Editorial text navigation with an underline indicator — deliberately not a row of pills.
export function CategoryTabs({ categories, selectedCategoryId, onSelect }: CategoryTabsProps) {
  if (categories.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex gap-6 overflow-x-auto border-b border-line px-4 pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
      <button
        className={cx('mb-[-1px] min-h-11 shrink-0 cursor-pointer border-b-2 px-0 pt-0 pb-3 text-body font-semibold transition-[color,border-color] duration-180 ease-cup', selectedCategoryId === null ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-muted')}
        role="tab"
        aria-selected={selectedCategoryId === null}
        onClick={() => onSelect(null)}
        type="button"
      >
        Barchasi
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          className={cx('mb-[-1px] min-h-11 shrink-0 cursor-pointer border-b-2 px-0 pt-0 pb-3 text-body font-semibold transition-[color,border-color] duration-180 ease-cup', selectedCategoryId === category.id ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-muted')}
          role="tab"
          aria-selected={selectedCategoryId === category.id}
          onClick={() => onSelect(category.id)}
          type="button"
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
