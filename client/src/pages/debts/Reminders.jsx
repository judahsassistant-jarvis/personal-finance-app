import NotificationsSettingsCard from '../../components/debts/NotificationsSettingsCard.jsx';

export default function Reminders() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reminders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Email reminder cadence for upcoming debt payments. Per-debt enable/disable
          lives on each debt's edit form.
        </p>
      </div>
      <NotificationsSettingsCard />
    </div>
  );
}
