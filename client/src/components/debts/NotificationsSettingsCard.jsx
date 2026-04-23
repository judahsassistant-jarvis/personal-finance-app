import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Bell } from 'lucide-react';
import { ensureDebtConfig, updateDebtConfig } from '../../store/debtConfigSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card.jsx';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';

/**
 * Edits `debt_config.reminder_days_before` (Sprint 7 companion UI for the
 * generatePaymentReminders Cloud Function). Per-user setting, 1–7 days. The
 * BT cliff thresholds (90/60/30/14) are fixed and don't have a knob here —
 * those are product-defined.
 */
export default function NotificationsSettingsCard() {
  const dispatch = useDispatch();
  const config = useSelector((s) => s.debtConfig.doc);
  const [value, setValue] = useState('3');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { dispatch(ensureDebtConfig()); }, [dispatch]);

  useEffect(() => {
    if (config?.reminder_days_before != null) {
      setValue(String(config.reminder_days_before));
      setDirty(false);
    }
  }, [config?.reminder_days_before]);

  const numeric = Number(value);
  const valid = Number.isInteger(numeric) && numeric >= 1 && numeric <= 7;
  const current = config?.reminder_days_before ?? 3;

  async function save() {
    if (!valid || !config?.id) return;
    setSaving(true);
    try {
      await dispatch(updateDebtConfig({ id: config.id, reminder_days_before: numeric })).unwrap();
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <Bell className="w-4 h-4 mt-0.5 text-muted-foreground" />
          <div>
            <CardTitle>Reminders</CardTitle>
            <CardDescription>
              Email reminders fire N days before each debt's payment due day, again 1 day before, and on the day itself.
              Reminders stop for that cycle once you tag a transaction against the debt on the Transactions page.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1.5">
            <label htmlFor="reminder-days" className="text-sm font-medium">Advance notice (days)</label>
            <Input
              id="reminder-days"
              type="number"
              min={1}
              max={7}
              className="w-24"
              value={value}
              onChange={(e) => { setValue(e.target.value); setDirty(true); }}
            />
          </div>
          <Button
            size="sm"
            variant="accent"
            onClick={save}
            disabled={!valid || !dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Currently: {current} {current === 1 ? 'day' : 'days'} ahead.
          </span>
        </div>
        {!valid && <p className="text-xs text-destructive">Must be between 1 and 7.</p>}
      </CardContent>
    </Card>
  );
}
