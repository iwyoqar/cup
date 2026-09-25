import { useEffect, useState } from 'react';
import { fetchLoyaltySettings, updateLoyaltySettings } from '../lib/loyaltySettings';
import { ApiError } from '../lib/api';
import { LoyaltySettings } from '../lib/types';
import { Button, LoadingState, Toggle } from '../ui';

const EXPIRY_PRESETS = [0, 30, 60, 90, 180, 365];

function fieldsEqual(a: LoyaltySettings, b: LoyaltySettings): boolean {
  return (Object.keys(a) as (keyof LoyaltySettings)[]).every((key) => a[key] === b[key]);
}

// Part 12: loads current values from the backend — never hardcodes a pre-fill default once
// settings have been persisted (the fallback used before ANY admin ever saves anything lives
// entirely server-side, see loyalty-settings.service.ts's DEFAULTS). Shows validation errors,
// a save-success state, and makes unsaved changes visible.
export function LoyaltySettingsPage() {
  const [saved, setSaved] = useState<LoyaltySettings | null>(null);
  const [draft, setDraft] = useState<LoyaltySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLoyaltySettings()
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings);
        setDraft(settings);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.backendMessage : 'Failed to load loyalty settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div>
        <p className="text-[13px] font-semibold text-err">{loadError}</p>
      </div>
    );
  }

  if (!draft || !saved) {
    return (
      <div>
        <LoadingState variant="card" />
      </div>
    );
  }

  const hasUnsavedChanges = !fieldsEqual(draft, saved);

  const set = <K extends keyof LoyaltySettings>(key: K, value: LoyaltySettings[K]) => {
    setJustSaved(false);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateLoyaltySettings(draft);
      setSaved(updated);
      setDraft(updated);
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.backendMessage : 'Failed to save loyalty settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const expiryOptions = EXPIRY_PRESETS.includes(draft.pointsExpireAfterDays)
    ? EXPIRY_PRESETS
    : [draft.pointsExpireAfterDays, ...EXPIRY_PRESETS].sort((a, b) => a - b);

  return (
    <div>

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Loyalty program</span>
          <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} />
        </div>

        <hr className="m-0 h-px border-0 bg-line" />

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Points earning</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <NumberInput value={draft.earnUnitAmount} onChange={(v) => set('earnUnitAmount', v)} /> so&apos;m ={' '}
            <NumberInput value={draft.earnRate} onChange={(v) => set('earnRate', v)} /> point(s)
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Minimum order for points</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <NumberInput value={draft.minimumOrderAmount} onChange={(v) => set('minimumOrderAmount', v)} /> so&apos;m
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Welcome bonus</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <NumberInput value={draft.welcomeBonus} onChange={(v) => set('welcomeBonus', v)} /> points
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Point expiration</span>
          <select
            value={draft.pointsExpireAfterDays}
            onChange={(e) => set('pointsExpireAfterDays', Number(e.target.value))}
          >
            {expiryOptions.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? 'Never' : `${days} days`}
              </option>
            ))}
          </select>
        </div>

        <hr className="m-0 h-px border-0 bg-line" />

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Spending</span>
          <Toggle checked={draft.spendEnabled} onChange={(v) => set('spendEnabled', v)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Point value</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            1 point = <NumberInput value={draft.pointValue} onChange={(v) => set('pointValue', v)} /> so&apos;m
          </div>
        </div>
      </div>

      {saveError && <p className="text-[13px] font-semibold text-err">{saveError}</p>}
      {justSaved && !hasUnsavedChanges && <p className="text-[13px] font-semibold text-ok">Saved.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button disabled={isSaving || !hasUnsavedChanges} onClick={handleSave} variant="primary">
          {isSaving ? 'Saving...' : 'Save changes'}
        </Button>
        {hasUnsavedChanges && <span className="inline-flex items-center rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-semibold text-warn">Unsaved changes</span>}
      </div>
    </div>
  );
}


interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
}

// Prevents accidental invalid input at the UI layer (spec Part 12) — min=0, integer step. The
// backend still validates independently regardless (Part 11: never trust frontend validation
// alone).
function NumberInput({ value, onChange }: NumberInputProps) {
  return (
    <input
      min={0}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        onChange(Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0);
      }}
      step={1}
      type="number"
      value={value}
    />
  );
}
