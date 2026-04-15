// Frontend-Komponenten für Analytics-Plugin
// Diese Datei würde in einer echten Implementierung im Frontend geladen werden

// Beispiel für Dashboard-Widget zur Anzeige der Nutzungsübersicht
const AnalyticsOverviewWidget = () => {
  // React-Hooks würden in einer echten Implementierung verwendet
  // const [data, setData] = useState(null);
  // const { isLoading, error, data } = useQuery(['analytics-overview'], fetchAnalyticsOverview);

  return (
    <div className="analytics-widget">
      <h3>Nutzungsübersicht</h3>
      <div className="analytics-stats">
        <div className="stat-card">
          <div className="stat-value">152</div>
          <div className="stat-label">Tasks heute</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">24.5K</div>
          <div className="stat-label">Token heute</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">€2.15</div>
          <div className="stat-label">Kosten heute</div>
        </div>
      </div>
    </div>
  );
};

// Beispiel für Dashboard-Widget zur Anzeige der Modell-Nutzung
const ModelUsageWidget = () => {
  // In einer echten Implementierung würden Daten vom Server geladen
  const modelData = [
    { name: 'claude-sonnet', tokens: 12500, cost: 1.25 },
    { name: 'gpt-3.5', tokens: 8000, cost: 0.45 },
    { name: 'ollama-local', tokens: 4000, cost: 0 },
  ];

  return (
    <div className="analytics-widget">
      <h3>Modell-Nutzung</h3>
      <table className="model-usage-table">
        <thead>
          <tr>
            <th>Modell</th>
            <th>Token</th>
            <th>Kosten</th>
          </tr>
        </thead>
        <tbody>
          {modelData.map(model => (
            <tr key={model.name}>
              <td>{model.name}</td>
              <td>{model.tokens.toLocaleString()}</td>
              <td>€{model.cost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Beispiel für eine vollständige Analytics-Seite
const AnalyticsPage = () => {
  // Zeitraum-Auswahl
  // const [timeRange, setTimeRange] = useState('today');

  return (
    <div className="analytics-page">
      <h1>Analytics Dashboard</h1>

      {/* Zeitraum-Auswahl */}
      <div className="time-range-selector">
        <select>
          <option value="today">Heute</option>
          <option value="yesterday">Gestern</option>
          <option value="week">Letzte 7 Tage</option>
          <option value="month">Letzter Monat</option>
          <option value="custom">Benutzerdefiniert</option>
        </select>
      </div>

      {/* Dashboard-Bereich */}
      <div className="analytics-dashboard">
        <div className="widget-row">
          <AnalyticsOverviewWidget />
          <ModelUsageWidget />
        </div>

        {/* Agent-Aktivität */}
        <div className="widget-full">
          <h3>Agent-Aktivität</h3>
          <div className="agent-activity-chart">
            {/* Hier würde ein Chart-Element stehen */}
            <div className="placeholder-chart">
              Balkendiagramm der Agent-Aktivität
            </div>
          </div>
        </div>

        {/* Token-Nutzung über Zeit */}
        <div className="widget-full">
          <h3>Token-Nutzung über Zeit</h3>
          <div className="token-usage-chart">
            {/* Hier würde ein Chart-Element stehen */}
            <div className="placeholder-chart">
              Liniendiagramm der Token-Nutzung
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Beispiel für Plugin-Einstellungsseite
const AnalyticsSettings = () => {
  // State für Einstellungen
  // const [settings, setSettings] = useState({ trackTokenUsage: true, retentionDays: 30 });

  return (
    <div className="analytics-settings">
      <h2>Analytics Einstellungen</h2>

      <div className="setting-item">
        <label>
          <input type="checkbox" checked={true} />
          Token-Nutzung verfolgen
        </label>
        <p className="setting-description">
          Verfolge die Nutzung von Token pro Modell und Agent
        </p>
      </div>

      <div className="setting-item">
        <label>
          Aufbewahrungstage:
          <input type="number" value={30} min={1} max={365} />
        </label>
        <p className="setting-description">
          Anzahl der Tage, für die Analysedaten aufbewahrt werden
        </p>
      </div>

      <div className="setting-actions">
        <button className="btn-save">Speichern</button>
        <button className="btn-reset">Zurücksetzen</button>
      </div>
    </div>
  );
};

// Exportiere alle Komponenten (in einer echten Implementierung)
export { AnalyticsOverviewWidget, ModelUsageWidget, AnalyticsPage, AnalyticsSettings };