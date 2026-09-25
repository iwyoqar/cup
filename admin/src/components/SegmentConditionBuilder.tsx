import { SEGMENT_FIELD_META, SEGMENT_FIELDS, SEGMENT_OPERATOR_LABELS, SegmentCondition, SegmentField } from '../lib/types';
import { Button } from '../ui';

interface SegmentConditionBuilderProps {
  conditions: SegmentCondition[];
  onChange: (conditions: SegmentCondition[]) => void;
}

// Field -> allowed operators is fully driven by SEGMENT_FIELD_META (mirrors the backend
// allowlist) — the UI can never construct a field/operator combination the backend would
// reject, though the backend re-validates independently regardless.
export function SegmentConditionBuilder({ conditions, onChange }: SegmentConditionBuilderProps) {
  const handleAdd = () => {
    const defaultField: SegmentField = 'orderCount';
    onChange([...conditions, { field: defaultField, operator: SEGMENT_FIELD_META[defaultField].operators[0], value: '' }]);
  };

  const handleRemove = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index: number, field: SegmentField) => {
    const next = [...conditions];
    // Changing the field resets the operator to the first valid one for that field, and
    // clears the value — an operator/value chosen for the OLD field's type may be meaningless
    // for the new one (e.g. a date string left over when switching to a numeric field).
    next[index] = { field, operator: SEGMENT_FIELD_META[field].operators[0], value: '' };
    onChange(next);
  };

  const handleOperatorChange = (index: number, operator: SegmentCondition['operator']) => {
    const next = [...conditions];
    next[index] = { ...next[index], operator };
    onChange(next);
  };

  const handleValueChange = (index: number, value: string) => {
    const next = [...conditions];
    next[index] = { ...next[index], value };
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {conditions.map((condition, index) => {
        const meta = SEGMENT_FIELD_META[condition.field];
        return (
          <div key={index} className="flex gap-2 items-center">
            <select value={condition.field} onChange={(e) => handleFieldChange(index, e.target.value as SegmentField)}>
              {SEGMENT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {SEGMENT_FIELD_META[field].label}
                </option>
              ))}
            </select>
            <select
              value={condition.operator}
              onChange={(e) => handleOperatorChange(index, e.target.value as SegmentCondition['operator'])}
            >
              {meta.operators.map((operator) => (
                <option key={operator} value={operator}>
                  {SEGMENT_OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
            {meta.valueType === 'date' ? (
              <input onChange={(e) => handleValueChange(index, e.target.value)} type="date" value={condition.value} />
            ) : meta.valueType === 'number' ? (
              <input
                onChange={(e) => handleValueChange(index, e.target.value)}
                placeholder="Value"
                type="number"
                value={condition.value}
              />
            ) : meta.options ? (
              <select onChange={(e) => handleValueChange(index, e.target.value)} value={condition.value}>
                <option value="">Choose…</option>
                {meta.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                onChange={(e) => handleValueChange(index, e.target.value)}
                placeholder={meta.placeholder ?? 'Branch name'}
                type="text"
                value={condition.value}
              />
            )}
            <Button onClick={() => handleRemove(index)} variant="secondary">
              Remove
            </Button>
          </div>
        );
      })}
      <Button onClick={handleAdd} className="self-start" variant="secondary">
        + Add condition
      </Button>
    </div>
  );
}
