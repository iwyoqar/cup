import { useEffect, useState } from 'react';
import { createRewardProgram, RewardProgramInput, updateRewardProgram } from '../lib/adminRewardPrograms';
import { ApiError } from '../lib/api';
import { CatalogCategory, fetchActiveCategories } from '../lib/adminCatalog';
import { RewardProgram } from '../lib/types';

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

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="reward-name">Name</label>
        <input id="reward-name" onChange={(e) => setName(e.target.value)} type="text" value={name} />
      </div>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="reward-description">Description</label>
        <input id="reward-description" onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
      </div>

      <h3>Rule (Buy X, Get Y)</h3>
      {rewardLocked && (
        <p className="hint-text">This program has existing redemptions — its qualifying category/buy quantity/reward quantity can no longer be changed.</p>
      )}

      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="reward-category">Qualifying category</label>
        {categories === null ? (
          <p className="hint-text">Loading categories...</p>
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

      <div className="field" style={{ maxWidth: 160 }}>
        <label htmlFor="reward-buy-quantity">Buy quantity</label>
        <input disabled={rewardLocked} id="reward-buy-quantity" min={1} onChange={(e) => setBuyQuantity(e.target.value)} type="number" value={buyQuantity} />
      </div>

      <div className="field" style={{ maxWidth: 160 }}>
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

      <p className="hint-text">Reward scope: any active product from the same qualifying category — the customer chooses which one.</p>

      <h3>Validity</h3>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="reward-starts-at">Starts at</label>
        <input id="reward-starts-at" onChange={(e) => setStartsAt(e.target.value)} type="datetime-local" value={startsAt} />
      </div>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="reward-ends-at">Ends at (optional)</label>
        <input id="reward-ends-at" onChange={(e) => setEndsAt(e.target.value)} type="datetime-local" value={endsAt} />
      </div>

      <div className="settings-row" style={{ maxWidth: 320, marginTop: 12 }}>
        <span className="settings-row__label">Active</span>
        <label className="toggle">
          <input checked={isActive} onChange={(e) => setIsActive(e.target.checked)} type="checkbox" />
          <span className="toggle__track" />
        </label>
      </div>

      {error && (
        <p className="error-text" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      <div className="settings-footer">
        <button className="button-primary" disabled={isSaving} type="submit">
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button className="button-secondary" disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
