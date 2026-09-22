import { useState } from 'react';
import { createSegment, SegmentInput, updateSegment } from '../lib/adminSegments';
import { ApiError } from '../lib/api';
import { Segment, SegmentCondition } from '../lib/types';
import { SegmentConditionBuilder } from './SegmentConditionBuilder';

interface SegmentFormProps {
  existing?: Segment; // present when editing, absent when creating
  onSaved: (segment: Segment) => void;
  onCancel: () => void;
}

export function SegmentForm({ existing, onSaved, onCancel }: SegmentFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [logic, setLogic] = useState<'AND' | 'OR'>(existing?.logic ?? 'AND');
  const [conditions, setConditions] = useState<SegmentCondition[]>(
    existing?.conditions ?? [{ field: 'orderCount', operator: 'greater_than_or_equal', value: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Name is required.');
      return;
    }
    if (conditions.length === 0) {
      setError('At least one condition is required.');
      return;
    }
    if (conditions.some((c) => c.value.trim().length === 0)) {
      setError('Every condition needs a value.');
      return;
    }

    setIsSaving(true);
    try {
      const input: SegmentInput = { name: name.trim(), description: description.trim() || undefined, logic, conditions };
      const saved = existing ? await updateSegment(existing.id, input) : await createSegment(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to save segment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{existing ? 'Edit segment' : 'Create segment'}</h1>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="segment-name">Name</label>
        <input id="segment-name" onChange={(e) => setName(e.target.value)} type="text" value={name} />
      </div>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="segment-description">Description</label>
        <input id="segment-description" onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
      </div>

      <div className="field" style={{ maxWidth: 200 }}>
        <label htmlFor="segment-logic">Logic</label>
        <select id="segment-logic" onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')} value={logic}>
          <option value="AND">Match ALL conditions (AND)</option>
          <option value="OR">Match ANY condition (OR)</option>
        </select>
      </div>

      <h3>Conditions</h3>
      <SegmentConditionBuilder conditions={conditions} onChange={setConditions} />

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
