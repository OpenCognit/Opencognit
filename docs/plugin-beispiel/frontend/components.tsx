// Frontend-Komponenten für das Beispiel-Plugin

// Dashboard-Widget für Plugin-Statistik
const ExampleStats = () => {
  // In einer echten Implementierung würden hier React-Hooks verwendet
  // const [stats, setStats] = useState({ eventsProcessed: 0, lastUpdate: '', notifications: [] });
  // const { isLoading, error, data } = useQuery(['example-stats'], fetchStats);

  // Beispiel-Daten für die Anzeige
  const stats = {
    eventsProcessed: 42,
    lastUpdate: new Date().toISOString(),
    notifications: [
      { id: '1', message: 'Neue Aufgabe erstellt: Beispiel-Aufgabe', type: 'info', timestamp: new Date().toISOString() },
      { id: '2', message: 'Aufgabe abgeschlossen: Beispiel-Aufgabe', type: 'success', timestamp: new Date().toISOString() }
    ]
  };

  return (
    <div className="example-stats-widget">
      <div className="stats-header">
        <h3>Plugin-Statistik</h3>
        <div className="stats-actions">
          <button className="btn-refresh">↻</button>
          <button className="btn-reset">Reset</button>
        </div>
      </div>

      <div className="stats-content">
        <div className="stat-item">
          <div className="stat-label">Verarbeitete Events</div>
          <div className="stat-value">{stats.eventsProcessed}</div>
        </div>

        <div className="stat-item">
          <div className="stat-label">Letzte Aktualisierung</div>
          <div className="stat-value">{new Date(stats.lastUpdate).toLocaleTimeString()}</div>
        </div>

        <div className="stat-item">
          <div className="stat-label">Benachrichtigungen</div>
          <div className="stat-value">{stats.notifications.length}</div>
        </div>
      </div>

      {stats.notifications.length > 0 && (
        <div className="notifications-list">
          <h4>Letzte Benachrichtigungen</h4>
          <ul>
            {stats.notifications.slice(0, 3).map(notification => (
              <li key={notification.id} className={`notification-${notification.type}`}>
                {notification.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Einstellungsseite für das Plugin
const ExampleSettings = () => {
  // In einer echten Implementierung würden hier React-Hooks verwendet
  // const [settings, setSettings] = useState({ enableNotifications: true, notificationSound: 'ping', refreshInterval: 60 });

  return (
    <div className="example-settings">
      <h2>Beispiel-Plugin Einstellungen</h2>

      <div className="setting-item">
        <label>
          <input type="checkbox" checked={true} />
          Benachrichtigungen aktivieren
        </label>
        <p className="setting-description">
          Benachrichtigungen für neue Ereignisse anzeigen
        </p>
      </div>

      <div className="setting-item">
        <label>
          Benachrichtigungston:
          <select value="ping">
            <option value="ping">Ping</option>
            <option value="ding">Ding</option>
            <option value="chime">Chime</option>
            <option value="none">Kein Ton</option>
          </select>
        </label>
        <p className="setting-description">
          Sound für Benachrichtigungen
        </p>
      </div>

      <div className="setting-item">
        <label>
          Aktualisierungsintervall (Sekunden):
          <input type="number" value={60} min={10} max={3600} />
        </label>
        <p className="setting-description">
          Intervall für die Aktualisierung der Daten
        </p>
      </div>

      <div className="setting-actions">
        <button className="btn-save">Speichern</button>
        <button className="btn-reset">Zurücksetzen</button>
      </div>

      <div className="stats-actions">
        <h3>Statistiken</h3>
        <button className="btn-reset-stats">Statistiken zurücksetzen</button>
        <p className="setting-description">
          Setzt alle gesammelten Statistiken zurück
        </p>
      </div>
    </div>
  );
};

// Exportiere alle Komponenten (in einer echten Implementierung)
export { ExampleStats, ExampleSettings };