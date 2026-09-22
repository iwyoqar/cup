import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchCampaigns } from '../lib/adminCampaigns';
import { CatalogCategory, fetchActiveCategories } from '../lib/adminCatalog';
import { fetchRewardPrograms } from '../lib/adminRewardPrograms';
import { fetchSegments } from '../lib/adminSegments';
import { AutomationInput, AutomationMeta, AutomationView, createAutomation, fetchAutomationMeta, TriggerConfig, TriggerType, updateAutomation } from '../lib/adminAutomations';

interface Props {
  existing: AutomationView | null;
  onCancel: () => void;
  onSaved: (a: AutomationView) => void;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const METRICS = [
  { value: 'lifetimeSpend', label: "Lifetime spend (so'm)" },
  { value: 'lifetimeXP', label: 'Lifetime XP' },
  { value: 'lifetimeCoffeeQuantity', label: 'Units in a category' },
  { value: 'rewardCount', label: 'Rewards redeemed' },
];

const DEFAULT_CONFIG: Record<TriggerType, TriggerConfig> = {
  FIRST_PURCHASE: { delayMinutes: 0 },
  REWARD_UNLOCKED: { rewardProgramId: '' },
  BIRTHDAY: { daysBefore: 0 },
  INACTIVE_CUSTOMER: { inactiveDays: 30, includeExisting: false },
  ABANDONED_CART: { delayMinutes: 30 },
  LOYALTY_MILESTONE: { metric: 'lifetimeSpend', threshold: 100000 },
  SCHEDULED_SEGMENT: { frequency: 'WEEKLY', weekday: 1, time: '10:00' },
};

async function loadAll<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

const num = (v: string) => (v === '' || !Number.isFinite(Number(v)) ? 0 : Math.trunc(Number(v)));

// Create / edit form. Trigger-specific fields appear dynamically; every rule is enforced again by the backend (this only saves a round trip).
export function AutomationForm({ existing, onCancel, onSaved }: Props) {
  const locked = existing?.status === 'ACTIVE'; // trigger / campaign / segment cannot change while running
  const [meta, setMeta] = useState<AutomationMeta | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [triggerType, setTriggerType] = useState<TriggerType>(existing?.triggerType ?? 'FIRST_PURCHASE');
  const [config, setConfig] = useState<TriggerConfig>(existing?.triggerConfig ?? DEFAULT_CONFIG.FIRST_PURCHASE);
  const [campaignId, setCampaignId] = useState(existing?.campaign.id ?? '');
  const [segmentId, setSegmentId] = useState(existing?.segment?.id ?? '');
  const [cooldownHours, setCooldownHours] = useState<string>(existing ? String(existing.cooldownHours) : '');
  const [maxSends, setMaxSends] = useState<string>(existing ? (existing.maxSendsPerCustomer === null ? '' : String(existing.maxSendsPerCustomer)) : '');

  useEffect(() => {
    Promise.all([fetchAutomationMeta(), loadAll(fetchCampaigns), loadAll(fetchSegments), loadAll(fetchRewardPrograms), fetchActiveCategories()])
      .then(([m, c, s, p, cat]) => {
        setMeta(m);
        setCampaigns(c.map((x) => ({ id: x.id, name: x.name, status: x.status })));
        setSegments(s.map((x) => ({ id: x.id, name: x.name })));
        setPrograms(p.map((x) => ({ id: x.id, name: x.name })));
        setCategories(cat);
        if (!existing) {
          setCooldownHours(String(m.defaults.cooldownHours));
          setMaxSends(String(m.defaults.maxSendsPerCustomer));
        }
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.backendMessage : 'Failed to load the form.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCfg = (patch: TriggerConfig) => setConfig((c) => ({ ...c, ...patch }));
  const changeTrigger = (t: TriggerType) => {
    setTriggerType(t);
    setConfig(DEFAULT_CONFIG[t]);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const cleaned: TriggerConfig = { ...config };
    if (triggerType === 'LOYALTY_MILESTONE' && cleaned.metric !== 'lifetimeCoffeeQuantity') delete cleaned.categoryId;
    if (triggerType === 'SCHEDULED_SEGMENT' && cleaned.frequency === 'DAILY') delete cleaned.weekday;
    const input: AutomationInput = {
      name,
      description: description.trim() === '' ? null : description,
      triggerType,
      triggerConfig: cleaned,
      campaignId,
      segmentId: segmentId === '' ? null : segmentId,
      cooldownHours: num(cooldownHours),
      maxSendsPerCustomer: maxSends === '' ? null : num(maxSends),
    };
    try {
      if (existing) {
        const patch: Partial<AutomationInput> = locked ? { name: input.name, description: input.description, cooldownHours: input.cooldownHours, maxSendsPerCustomer: input.maxSendsPerCustomer } : input;
        onSaved(await updateAutomation(existing.id, patch));
      } else {
        onSaved(await createAutomation(input));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.backendMessage : 'Failed to save.';
      setError(typeof message === 'string' ? message : 'The automation is not valid. Check the fields.');
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <p className="error-text">{loadError}</p>;
  if (!meta) return <p className="hint-text">Loading...</p>;

  const cfgNum = (key: string) => String(config[key] ?? '');
  const campaign = campaigns.find((c) => c.id === campaignId);

  return (
    <div>
      <button className="button-secondary" onClick={onCancel} type="button" style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1>{existing ? 'Edit automation' : 'New automation'}</h1>
      {locked && <p className="hint-text">This automation is ACTIVE: pause it to change the trigger, campaign or segment.</p>}

      <div className="settings-card">
        <div className="field">
          <label htmlFor="a-name">Name</label>
          <input id="a-name" maxLength={100} onChange={(e) => setName(e.target.value)} type="text" value={name} />
        </div>
        <div className="field">
          <label htmlFor="a-desc">Description</label>
          <input id="a-desc" maxLength={500} onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
        </div>

        <div className="field">
          <label htmlFor="a-trigger">Trigger</label>
          <select disabled={locked} id="a-trigger" onChange={(e) => changeTrigger(e.target.value as TriggerType)} value={triggerType}>
            {meta.triggers.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="hint-text">{meta.triggers.find((t) => t.type === triggerType)?.description}</span>
        </div>

        {triggerType === 'FIRST_PURCHASE' && (
          <div className="field">
            <label>Delay after the purchase (minutes)</label>
            <input disabled={locked} min={0} onChange={(e) => setCfg({ delayMinutes: num(e.target.value) })} type="number" value={cfgNum('delayMinutes')} />
          </div>
        )}
        {triggerType === 'REWARD_UNLOCKED' && (
          <div className="field">
            <label>Reward program</label>
            <select disabled={locked} onChange={(e) => setCfg({ rewardProgramId: e.target.value })} value={String(config.rewardProgramId ?? '')}>
              <option value="">Choose…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {triggerType === 'BIRTHDAY' && (
          <div className="field">
            <label>Days before the birthday (0 = on the day)</label>
            <input disabled={locked} max={30} min={0} onChange={(e) => setCfg({ daysBefore: num(e.target.value) })} type="number" value={cfgNum('daysBefore')} />
          </div>
        )}
        {triggerType === 'INACTIVE_CUSTOMER' && (
          <>
            <div className="field">
              <label>Days inactive</label>
              <input disabled={locked} min={1} onChange={(e) => setCfg({ inactiveDays: num(e.target.value) })} type="number" value={cfgNum('inactiveDays')} />
            </div>
            <label className="hint-text">
              <input checked={config.includeExisting === true} disabled={locked} onChange={(e) => setCfg({ includeExisting: e.target.checked })} type="checkbox" /> Also include customers who were already inactive before activation
            </label>
          </>
        )}
        {triggerType === 'ABANDONED_CART' && (
          <div className="field">
            <label>Delay (minutes) — must be shorter than the cart expiry ({meta.cartExpiryMinutes} min)</label>
            <input disabled={locked} min={1} onChange={(e) => setCfg({ delayMinutes: num(e.target.value) })} type="number" value={cfgNum('delayMinutes')} />
          </div>
        )}
        {triggerType === 'LOYALTY_MILESTONE' && (
          <>
            <div className="field">
              <label>Metric</label>
              <select disabled={locked} onChange={(e) => setCfg({ metric: e.target.value })} value={String(config.metric ?? 'lifetimeSpend')}>
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {config.metric === 'lifetimeCoffeeQuantity' && (
              <div className="field">
                <label>Category</label>
                <select disabled={locked} onChange={(e) => setCfg({ categoryId: e.target.value })} value={String(config.categoryId ?? '')}>
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Threshold</label>
              <input disabled={locked} min={1} onChange={(e) => setCfg({ threshold: num(e.target.value) })} type="number" value={cfgNum('threshold')} />
            </div>
          </>
        )}
        {triggerType === 'SCHEDULED_SEGMENT' && (
          <>
            <div className="field">
              <label>Frequency</label>
              <select disabled={locked} onChange={(e) => setCfg({ frequency: e.target.value, ...(e.target.value === 'WEEKLY' ? { weekday: 1 } : { weekday: undefined }) })} value={String(config.frequency ?? 'WEEKLY')}>
                <option value="DAILY">Every day</option>
                <option value="WEEKLY">Every week</option>
              </select>
            </div>
            {config.frequency === 'WEEKLY' && (
              <div className="field">
                <label>Weekday</label>
                <select disabled={locked} onChange={(e) => setCfg({ weekday: Number(e.target.value) })} value={String(config.weekday ?? 1)}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Time (business time)</label>
              <input disabled={locked} onChange={(e) => setCfg({ time: e.target.value })} type="time" value={String(config.time ?? '10:00')} />
            </div>
          </>
        )}

        <div className="field">
          <label>Segment {triggerType === 'SCHEDULED_SEGMENT' ? '(the audience — required)' : '(optional filter)'}</label>
          <select disabled={locked} onChange={(e) => setSegmentId(e.target.value)} value={segmentId}>
            <option value="">{triggerType === 'SCHEDULED_SEGMENT' ? 'Choose…' : 'Everyone the trigger matches'}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Campaign (the message and channel)</label>
          <select disabled={locked} onChange={(e) => setCampaignId(e.target.value)} value={campaignId}>
            <option value="">Choose…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
          <span className="hint-text">
            The message text comes from the campaign. Allowed variables: {meta.variables.map((v) => `{{${v}}}`).join(' ')}.
            {campaign && campaign.status !== 'draft' && campaign.status !== 'completed' ? ' This campaign is not ready (being sent or failed).' : ''}
          </span>
        </div>

        <div className="field">
          <label>Cooldown (hours between sends to the same customer)</label>
          <input min={0} onChange={(e) => setCooldownHours(e.target.value)} type="number" value={cooldownHours} />
        </div>
        <div className="field">
          <label>Max sends per customer (empty = unlimited)</label>
          <input min={1} onChange={(e) => setMaxSends(e.target.value)} type="number" value={maxSends} />
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="settings-footer">
        <button className="button-primary" disabled={saving || name.trim() === '' || campaignId === ''} onClick={submit} type="button">
          {saving ? 'Saving...' : existing ? 'Save changes' : 'Create automation'}
        </button>
        <button className="button-secondary" disabled={saving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
