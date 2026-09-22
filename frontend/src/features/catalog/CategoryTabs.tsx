import { Category } from '../../types/api';

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
    <div className="category-tabs" role="tablist">
      <button
        className={`category-tab${selectedCategoryId === null ? ' category-tab--active' : ''}`}
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
          className={`category-tab${selectedCategoryId === category.id ? ' category-tab--active' : ''}`}
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
