import { useCallback, useEffect, useState } from 'react';
import { CatalogCategory, fetchActiveCategories } from '../lib/adminCatalog';
import {
  AchievementRow,
  CONDITION_LABELS,
  createLoyalty2Achievement,
  fetchLoyalty2Achievements,
  fetchLoyalty2Levels,
  fetchLoyalty2Settings,
  fetchPointsRule,
  Loyalty2Settings,
  LoyaltyLevelRow,
  saveLoyalty2Levels,
  updateLoyalty2Achievement,
  updateLoyalty2Settings,
  updatePointsRule,
} from '../lib/adminLoyalty2';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { LoyaltySettings } from '../lib/types';
import { ErrorState, LoadingState } from '../ui';

const message = (err: unknown) => (err instanceof ApiError ? err.backendMessage : 'Request failed.');

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
      <span className="toggle__track" />
    </label>
  );
}

function Num({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return <input min={min} onChange={(e) => onChange(Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : min)} step={step} style={{ width: 110 }} type="number" value={value} />;
}

// Phase 12 — Loyalty 2.0 admin: program switches, membership levels, achievements. Nothing here is hardcoded: every value is
// loaded from and saved to the server, which validates it again (the UI checks are a convenience, never the boundary).
export function Loyalty2Page() {
  const [settings, setSettings] = useState<Loyalty2Settings | null>(null);
  const [draft, setDraft] = useState<Loyalty2Settings | null>(null);
  const [rule, setRule] = useState<LoyaltySettings | null>(null);
  const [ruleDraft, setRuleDraft] = useState<{ earnRate: number; earnUnitAmount: number } | null>(null);
  const [levels, setLevels] = useState<LoyaltyLevelRow[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementRow[] | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([fetchLoyalty2Settings(), fetchLoyalty2Levels(), fetchLoyalty2Achievements(), fetchPointsRule(), fetchActiveCategories()])
      .then(([s, l, a, r, c]) => {
        setSettings(s);
        setDraft(s);
        setLevels(l);
        setAchievements(a);
        setRule(r);
        setRuleDraft({ earnRate: r.earnRate, earnUnitAmount: r.earnUnitAmount });
        setCategories(c);
      })
      .catch((err) => setError(message(err)));
  }, []);

  useEffect(load, [load]);

  if (error && !settings) {
    return (
      <ErrorState message={error} onRetry={load} title="Loyalty 2.0 could not be loaded" />
    );
  }
  if (!settings || !draft || !levels || !achievements || !rule || !ruleDraft) {
    return (
      <div>
        <LoadingState variant="card" />
      </div>
    );
  }

  const run = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okText);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const setD = <K extends keyof Loyalty2Settings>(key: K, value: Loyalty2Settings[K]) => setDraft({ ...draft, [key]: value });
  const settingsChanged = JSON.stringify(draft) !== JSON.stringify(settings) || ruleDraft.earnRate !== rule.earnRate || ruleDraft.earnUnitAmount !== rule.earnUnitAmount;

  const saveSettings = () =>
    run(async () => {
      const { accrualStartsAt: _ignored, ...rest } = draft;
      void _ignored;
      if (ruleDraft.earnRate !== rule.earnRate || ruleDraft.earnUnitAmount !== rule.earnUnitAmount) {
        const r = await updatePointsRule({ earnRate: ruleDraft.earnRate, earnUnitAmount: ruleDraft.earnUnitAmount });
        setRule(r);
        setRuleDraft({ earnRate: r.earnRate, earnUnitAmount: r.earnUnitAmount });
      }
      const s = await updateLoyalty2Settings(rest);
      setSettings(s);
      setDraft(s);
    }, 'Settings saved.');

  const setLevel = (code: string, patch: Partial<LoyaltyLevelRow>) => setLevels(levels.map((l) => (l.code === code ? { ...l, ...patch } : l)));

  return (
    <div>
      <p className="hint-text">Membership levels, XP, cashback, achievements, streak and birthday. Everything is configuration; nothing is earned until the program is switched on.</p>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}

      <div className="settings-card">
        <h3 style={{ margin: 0 }}>Program</h3>
        <div className="settings-row">
          <span className="settings-row__label">Loyalty 2.0 enabled</span>
          <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
        </div>
        <p className="hint-text" style={{ margin: 0 }}>
          {settings.accrualStartsAt ? `Cashback and points accrue only for purchases from ${formatDateTime(settings.accrualStartsAt)}. Level and XP use the full purchase history.` : 'The first time the program is enabled, the accrual start is set to that moment (no retroactive cashback).'}
        </p>
        <hr className="settings-divider" />
        <div className="settings-row">
          <span className="settings-row__label">XP</span>
          <div className="settings-row__control">
            <Num min={0} onChange={(v) => setD('xpRate', v)} value={draft.xpRate} /> XP per <Num min={1} onChange={(v) => setD('xpUnitAmount', v)} value={draft.xpUnitAmount} /> so&apos;m
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Cashback (percent is set per level below)</span>
          <Toggle checked={draft.cashbackEnabled} onChange={(v) => setD('cashbackEnabled', v)} />
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Earn loyalty points on purchases</span>
          <Toggle checked={draft.purchasePointsEnabled} onChange={(v) => setD('purchasePointsEnabled', v)} />
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Points earn rate (existing loyalty rule)</span>
          <div className="settings-row__control">
            <Num min={1} onChange={(v) => setRuleDraft({ ...ruleDraft, earnUnitAmount: v })} value={ruleDraft.earnUnitAmount} /> so&apos;m ={' '}
            <Num min={0} onChange={(v) => setRuleDraft({ ...ruleDraft, earnRate: v })} value={ruleDraft.earnRate} /> point(s) × level multiplier
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Visit streak</span>
          <Toggle checked={draft.streakEnabled} onChange={(v) => setD('streakEnabled', v)} />
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Birthday reward</span>
          <Toggle checked={draft.birthdayEnabled} onChange={(v) => setD('birthdayEnabled', v)} />
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Birthday reward points / window (days)</span>
          <div className="settings-row__control">
            <Num min={0} onChange={(v) => setD('birthdayRewardPoints', v)} value={draft.birthdayRewardPoints} /> <Num min={1} onChange={(v) => setD('birthdayWindowDays', v)} value={draft.birthdayWindowDays} />
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Referral (legacy flag, not used — configure the program under Admin › Referrals)</span>
          <Toggle checked={draft.referralEnabled} onChange={(v) => setD('referralEnabled', v)} />
        </div>
        <div>
          <button className="button-primary" disabled={busy || !settingsChanged} onClick={saveSettings} type="button">
            {busy ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3 style={{ margin: 0 }}>Membership levels</h3>
        <p className="hint-text" style={{ margin: 0 }}>A customer&apos;s level is derived from lifetime spend (CUP + POS) — it is never assigned by hand. The lowest level must start at 0.</p>
        <div className="c360__scroll">
          <table className="data-table" style={{ marginTop: 0, minWidth: 780 }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Icon</th>
                <th>Color</th>
                <th>From (so&apos;m)</th>
                <th>Cashback %</th>
                <th>Points ×%</th>
                <th>Priority</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.code}>
                  <td>{l.code}</td>
                  <td><input onChange={(e) => setLevel(l.code, { name: e.target.value })} style={{ width: 100 }} value={l.name} /></td>
                  <td><input onChange={(e) => setLevel(l.code, { icon: e.target.value })} style={{ width: 50 }} value={l.icon} /></td>
                  <td><input onChange={(e) => setLevel(l.code, { color: e.target.value })} style={{ width: 90 }} value={l.color} /></td>
                  <td><Num min={0} onChange={(v) => setLevel(l.code, { minLifetimeSpend: v })} value={l.minLifetimeSpend} /></td>
                  <td><Num min={0} onChange={(v) => setLevel(l.code, { cashbackRateBps: Math.round(v * 100) })} step={0.1} value={l.cashbackRateBps / 100} /></td>
                  <td><Num min={0} onChange={(v) => setLevel(l.code, { pointMultiplierPercent: v })} value={l.pointMultiplierPercent} /></td>
                  <td><Toggle checked={l.prioritySupport} onChange={(v) => setLevel(l.code, { prioritySupport: v })} /></td>
                  <td><Toggle checked={l.isActive} onChange={(v) => setLevel(l.code, { isActive: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button
            className="button-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setLevels(await saveLoyalty2Levels(levels.map(({ code, name, color, icon, minLifetimeSpend, cashbackRateBps, pointMultiplierPercent, prioritySupport, isActive }) => ({ code, name, color, icon, minLifetimeSpend, cashbackRateBps, pointMultiplierPercent, prioritySupport, isActive }))));
              }, 'Levels saved.')
            }
            type="button"
          >
            Save levels
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3 style={{ margin: 0 }}>Achievements</h3>
        <p className="hint-text" style={{ margin: 0 }}>Unlock automatically, once per customer. Coffee achievements need a category before they can be activated.</p>
        <div className="c360__scroll">
          <table className="data-table" style={{ marginTop: 0, minWidth: 860 }}>
            <thead>
              <tr>
                <th>Achievement</th>
                <th>Condition</th>
                <th>Target</th>
                <th>Extra</th>
                <th>Reward pts</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {achievements.map((a) => (
                <AchievementRowEditor categories={categories} key={a.id} onSaved={(saved) => setAchievements(achievements.map((x) => (x.id === saved.id ? saved : x)))} row={a} run={run} />
              ))}
            </tbody>
          </table>
        </div>
        <NewAchievement
          categories={categories}
          onCreated={(created) => setAchievements([...achievements, created])}
          run={run}
        />
      </div>
    </div>
  );
}

type Runner = (action: () => Promise<void>, okText: string) => Promise<void>;

function AchievementRowEditor({ row, categories, onSaved, run }: { row: AchievementRow; categories: CatalogCategory[]; onSaved: (a: AchievementRow) => void; run: Runner }) {
  const [d, setD] = useState(row);
  const changed = JSON.stringify(d) !== JSON.stringify(row);
  return (
    <tr>
      <td>
        <input onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 44 }} value={d.icon} />{' '}
        <input onChange={(e) => setD({ ...d, name: e.target.value })} style={{ width: 130 }} value={d.name} />
        <div className="hint-text">{d.code}</div>
      </td>
      <td>{CONDITION_LABELS[d.conditionType] ?? d.conditionType}</td>
      <td><Num min={1} onChange={(v) => setD({ ...d, conditionValue: v })} value={d.conditionValue} /></td>
      <td>
        {d.conditionType === 'CATEGORY_UNITS' && (
          <select onChange={(e) => setD({ ...d, categoryId: e.target.value || null })} value={d.categoryId ?? ''}>
            <option value="">Choose category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {d.conditionType === 'MORNING_PURCHASES' && (
          <span>
            before <Num min={1} onChange={(v) => setD({ ...d, conditionParam: v })} value={d.conditionParam ?? 11} />:00
          </span>
        )}
      </td>
      <td><Num min={0} onChange={(v) => setD({ ...d, rewardPoints: v })} value={d.rewardPoints} /></td>
      <td><Toggle checked={d.isActive} onChange={(v) => setD({ ...d, isActive: v })} /></td>
      <td>
        <button
          className="button-secondary"
          disabled={!changed}
          onClick={() =>
            run(async () => {
              const saved = await updateLoyalty2Achievement(row.id, { name: d.name, description: d.description, icon: d.icon, conditionType: d.conditionType, conditionValue: d.conditionValue, conditionParam: d.conditionParam, categoryId: d.categoryId, rewardPoints: d.rewardPoints, isActive: d.isActive, sortOrder: d.sortOrder });
              setD(saved);
              onSaved(saved);
            }, `${d.name} saved.`)
          }
          type="button"
        >
          Save
        </button>
      </td>
    </tr>
  );
}

function NewAchievement({ categories, onCreated, run }: { categories: CatalogCategory[]; onCreated: (a: AchievementRow) => void; run: Runner }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ code: '', name: '', description: '', icon: '🏅', conditionType: 'TOTAL_PURCHASES', conditionValue: 1, conditionParam: null as number | null, categoryId: null as string | null, rewardPoints: 0, isActive: false });
  if (!open) {
    return (
      <div>
        <button className="button-secondary" onClick={() => setOpen(true)} type="button">
          Add achievement
        </button>
      </div>
    );
  }
  return (
    <div className="settings-card" style={{ margin: 0 }}>
      <div className="settings-row">
        <span className="settings-row__label">Code / name / icon</span>
        <div className="settings-row__control">
          <input onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} placeholder="CODE" style={{ width: 130 }} value={d.code} />
          <input onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Name" style={{ width: 150 }} value={d.name} />
          <input onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 50 }} value={d.icon} />
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Description</span>
        <input onChange={(e) => setD({ ...d, description: e.target.value })} style={{ width: 320 }} value={d.description} />
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Condition</span>
        <div className="settings-row__control">
          <select onChange={(e) => setD({ ...d, conditionType: e.target.value })} value={d.conditionType}>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          ≥ <Num min={1} onChange={(v) => setD({ ...d, conditionValue: v })} value={d.conditionValue} />
          {d.conditionType === 'CATEGORY_UNITS' && (
            <select onChange={(e) => setD({ ...d, categoryId: e.target.value || null })} value={d.categoryId ?? ''}>
              <option value="">Choose category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {d.conditionType === 'MORNING_PURCHASES' && <Num min={1} onChange={(v) => setD({ ...d, conditionParam: v })} value={d.conditionParam ?? 11} />}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Reward points / active</span>
        <div className="settings-row__control">
          <Num min={0} onChange={(v) => setD({ ...d, rewardPoints: v })} value={d.rewardPoints} /> <Toggle checked={d.isActive} onChange={(v) => setD({ ...d, isActive: v })} />
        </div>
      </div>
      <div>
        <button
          className="button-primary"
          onClick={() =>
            run(async () => {
              const created = await createLoyalty2Achievement({ ...d, sortOrder: 100 });
              onCreated(created);
              setOpen(false);
            }, 'Achievement created.')
          }
          type="button"
        >
          Create
        </button>{' '}
        <button className="button-secondary" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
