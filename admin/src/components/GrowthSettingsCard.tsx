import { useState } from 'react';
import { ApiError } from '../lib/api';
import { GrowthSettings, updateGrowthSettings } from '../lib/adminGrowth';

type NumKey = Exclude<keyof GrowthSettings, 'recencyDaysBoundaries' | 'frequencyBoundaries' | 'monetaryBoundaries'>;
type ListKey = 'recencyDaysBoundaries' | 'frequencyBoundaries' | 'monetaryBoundaries';

const NUMBERS: { key: NumKey; label: string }[] = [
  { key: 'lookbackDays', label: 'Default RFM lookback (days) — frequency and monetary are counted inside it' },
  { key: 'newDays', label: 'NEW: first purchase within (days)' },
  { key: 'activeDays', label: 'ACTIVE: last purchase within (days)' },
  { key: 'dormantDays', label: 'AT_RISK until (days since last purchase); longer is DORMANT' },
  { key: 'churnDays', label: 'DORMANT until (days); longer is CHURNED' },
  { key: 'loyalMinPurchases', label: 'LOYAL: lifetime purchases at least' },
  { key: 'loyalMinRevenue', label: 'LOYAL: lifetime revenue at least (so’m; 0 = no condition)' },
  { key: 'highValueRevenue', label: 'High-value threshold: lifetime revenue (so’m)' },
  { key: 'risingDays', label: 'Rising: crossed the high-value threshold within (days)' },
  { key: 'secondPurchaseDueDays', label: 'Second purchase is due after (days)' },
  { key: 'signalWindowDays', label: 'Recent-event window for signals (days)' },
  { key: 'birthdayLookaheadDays', label: 'Birthday upcoming within (days)' },
  { key: 'upgradeProximityPercent', label: 'Loyalty upgrade: within (%) of the next level' },
];

const LISTS: { key: ListKey; label: string; hint: string }[] = [
  { key: 'recencyDaysBoundaries', label: 'Recency boundaries (days)', hint: 'Max days since the last purchase for scores 5, 4, 3, 2 — longer scores 1' },
  { key: 'frequencyBoundaries', label: 'Frequency boundaries (purchases)', hint: 'Minimum purchases in the lookback for scores 2, 3, 4, 5' },
  { key: 'monetaryBoundaries', label: 'Monetary boundaries (so’m)', hint: 'Minimum revenue in the lookback for scores 2, 3, 4, 5' },
];

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};

// The configurable thresholds behind every lifecycle state, RFM score, signal and opportunity. Saving only changes how customers are LABELLED —
// nothing is sent or changed for any customer. The server validates the whole set (ordering rules) again.
export function GrowthSettingsCard({ settings, onSaved }: { settings: GrowthSettings; onSaved: (s: GrowthSettings) => void }) {
  const [draft, setDraft] = useState<GrowthSettings>(settings);
  const [lists, setLists] = useState<Record<ListKey, string>>({
    recencyDaysBoundaries: settings.recencyDaysBoundaries.join(', '),
    frequencyBoundaries: settings.frequencyBoundaries.join(', '),
    monetaryBoundaries: settings.monetaryBoundaries.join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parse = (raw: string) => raw.split(',').map((p) => Number(p.trim()));
  const next: GrowthSettings = { ...draft, recencyDaysBoundaries: parse(lists.recencyDaysBoundaries), frequencyBoundaries: parse(lists.frequencyBoundaries), monetaryBoundaries: parse(lists.monetaryBoundaries) };
  const changed = JSON.stringify(next) !== JSON.stringify(settings);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateGrowthSettings(next);
      setDraft(saved);
      onSaved(saved);
      setNotice('Thresholds saved — the dashboard has been recalculated.');
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="growth__settings">
      <p className="analytics__note" style={{ margin: 0 }}>
        These thresholds only decide how customers are labelled. Lifecycle precedence: CHURNED, DORMANT, AT_RISK (by days since the last purchase), then NEW, LOYAL, ACTIVE. “Beyond” a threshold means strictly more days.
      </p>
      <div className="growth__fields">
        {NUMBERS.map((f) => (
          <label className="growth__field" key={f.key}>
            <span>{f.label}</span>
            <input min={0} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))} type="number" value={draft[f.key]} />
          </label>
        ))}
        {LISTS.map((f) => (
          <label className="growth__field" key={f.key}>
            <span>
              {f.label}
              <em>{f.hint}</em>
            </span>
            <input onChange={(e) => setLists((l) => ({ ...l, [f.key]: e.target.value }))} value={lists[f.key]} />
          </label>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}
      <div>
        <button className="button-primary" disabled={!changed || saving} onClick={save} type="button">
          {saving ? 'Saving...' : 'Save thresholds'}
        </button>
      </div>
    </div>
  );
}
