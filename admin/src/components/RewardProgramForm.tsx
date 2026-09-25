import { useEffect, useState } from 'react';
import { createRewardProgram, RewardProgramInput, updateRewardProgram } from '../lib/adminRewardPrograms';
import { ApiError } from '../lib/api';
import { CatalogCategory, fetchActiveCategories } from '../lib/adminCatalog';
import { RewardProgram } from '../lib/types';
import { Button, Toggle } from '../ui';

interface RewardProgramFormProps {
  existing?: RewardProgram;
  onSaved: (program: RewardProgram) => void;
  onCancel: () => void;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export function RewardProgramForm({ existing, onSaved, onCancel }: RewardProgramFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [qualifyingCategoryId, setQualifyingCategoryId] = useState(existing?.qualifyingCategory.id ?? '');
  const [buyQuantity, setBuyQuantity] = useState(existing?.buyQuantity?.toString() ?? '5');
  const [rewardQuantity, setRewardQuantity] = useState(existing?.rewardQuantity?.toString() ?? '1');
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(existing?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(existing?.endsAt ?? null));
  const [isActive, setIsActive] = useState(existing?.isActive ?? false);

  const [categories, setCategories] = useState<CatalogCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const rewardLocked = (existing?.redemptionCount ?? 0) > 0;

  useEffect(() => {
    fetchActiveCategories()
      .then((all) => setCategories(all.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Name is required.');
      return;
    }
    if (!startsAt) {
      setError('Start date is required.');
      return;
    }
    if (!rewardLocked && !qualifyingCategoryId) {
      setError('Select a qualifying category.');
      return;
    }

    const input: RewardProgramInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      type: 'BUY_X_GET_Y',
      qualifyingCategoryId,
      buyQuantity: Number(buyQuantity),
      rewardQuantity: Number(rewardQuantity),
      startsAt: fromDatetimeLocal(startsAt)!,
      endsAt: fromDatetimeLocal(endsAt),
      isActive,
    };

    setIsSaving(true);
    try {
      const saved = existing ? await updateRewardProgram(existing.id, input) : await createRewardProgram(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to save reward program.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{existing ? 'Edit reward program' : 'Create reward program'}</h1>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[420px]">
        <label htmlFor="reward-name">Name</label>
        <input id="reward-name" onChange={(e) => setName(e.target.value)} type="text" value={name} />
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[420px]">
        <label htmlFor="reward-description">Description</label>
        <input id="reward-description" onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
      </div>

      <h3>Rule (Buy X, Get Y)</h3>
      {rewardLocked && (
        <p className="text-[13px] leading-snug text-muted">This program has existing redemptions — its qualifying category/buy quantity/reward quantity can no longer be changed.</p>
      )}

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[320px]">
        <label htmlFor="reward-category">Qualifying category</label>
        {categories === null ? (
          <p className="text-[13px] leading-snug text-muted">Loading categories...</p>
        ) : (
          <select
            disabled={rewardLocked}
            id="reward-category"
            onChange={(e) => setQualifyingCategoryId(e.target.value)}
            value={qualifyingCategoryId}
          >
            <option value="">Select a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[160px]">
        <label htmlFor="reward-buy-quantity">Buy quantity</label>
        <input disabled={rewardLocked} id="reward-buy-quantity" min={1} onChange={(e) => setBuyQuantity(e.target.value)} type="number" value={buyQuantity} />
      </div>

      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[160px]">
        <label htmlFor="reward-reward-quantity">Reward quantity</label>
        <input
          disabled={rewardLocked}
          id="reward-reward-quantity"
          min={1}
          onChange={(e) => setRewardQuantity(e.target.value)}
          type="number"
          value={rewardQuantity}
        />
      </div>

      <p className="text-[13px] leading-snug text-muted">Reward scope: any active product from the same qualifying category — the customer chooses which one.</p>

      <h3>Validity</h3>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[260px]">
        <label htmlFor="reward-starts-at">Starts at</label>
        <input id="reward-starts-at" onChange={(e) => setStartsAt(e.target.value)} type="datetime-local" value={startsAt} />
      </div>
      <div className="flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted max-w-[260px]">
        <label htmlFor="reward-ends-at">Ends at (optional)</label>
        <input id="reward-ends-at" onChange={(e) => setEndsAt(e.target.value)} type="datetime-local" value={endsAt} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0 max-w-[320px] mt-3">
        <span className="text-sm font-semibold">Active</span>
        <Toggle checked={isActive} label="Active" onChange={setIsActive} />
      </div>

      {error && (
        <p className="text-[13px] font-semibold text-err mt-4">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button disabled={isSaving} type="submit" variant="primary">
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button disabled={isSaving} onClick={onCancel} variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}
