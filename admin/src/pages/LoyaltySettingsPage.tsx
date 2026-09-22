import { useEffect, useState } from 'react';
import { fetchLoyaltySettings, updateLoyaltySettings } from '../lib/loyaltySettings';
import { ApiError } from '../lib/api';
import { LoyaltySettings } from '../lib/types';
import { LoadingState } from '../ui';

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
        <p className="error-text">{loadError}</p>
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

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row__label">Loyalty program</span>
          <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} />
        </div>

        <hr className="settings-divider" />

        <div className="settings-row">
          <span className="settings-row__label">Points earning</span>
          <div className="settings-row__control">
            <NumberInput value={draft.earnUnitAmount} onChange={(v) => set('earnUnitAmount', v)} /> so&apos;m ={' '}
            <NumberInput value={draft.earnRate} onChange={(v) => set('earnRate', v)} /> point(s)
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Minimum order for points</span>
          <div className="settings-row__control">
            <NumberInput value={draft.minimumOrderAmount} onChange={(v) => set('minimumOrderAmount', v)} /> so&apos;m
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Welcome bonus</span>
          <div className="settings-row__control">
            <NumberInput value={draft.welcomeBonus} onChange={(v) => set('welcomeBonus', v)} /> points
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Point expiration</span>
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

        <hr className="settings-divider" />

        <div className="settings-row">
          <span className="settings-row__label">Spending</span>
          <Toggle checked={draft.spendEnabled} onChange={(v) => set('spendEnabled', v)} />
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Point value</span>
          <div className="settings-row__control">
            1 point = <NumberInput value={draft.pointValue} onChange={(v) => set('pointValue', v)} /> so&apos;m
          </div>
        </div>
      </div>

      {saveError && <p className="error-text">{saveError}</p>}
      {justSaved && !hasUnsavedChanges && <p className="success-text">Saved.</p>}

      <div className="settings-footer">
        <button className="button-primary" disabled={isSaving || !hasUnsavedChanges} onClick={handleSave} type="button">
          {isSaving ? 'Saving...' : 'Save changes'}
        </button>
        {hasUnsavedChanges && <span className="unsaved-badge">Unsaved changes</span>}
      </div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
      <span className="toggle__track" />
    </label>
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
