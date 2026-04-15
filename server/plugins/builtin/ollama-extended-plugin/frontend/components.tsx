// Frontend-Komponenten für Ollama Extended Plugin

// Einstellungsseite für Ollama Extended
const OllamaSettings = () => {
  // State für Einstellungen
  // const [settings, setSettings] = useState({
  //   ollamaUrl: 'http://localhost:11434',
  //   defaultModel: 'llama3',
  //   contextWindow: 4096,
  //   enableCache: true
  // });

  // State für verfügbare Modelle
  // const [models, setModels] = useState([]);
  // const [loading, setLoading] = useState(false);

  // Simulierte Modelle
  const models = [
    { id: 'llama3', name: 'Llama 3 8B', size: '8B', quantization: 'Q5_K_M' },
    { id: 'mistral', name: 'Mistral 7B', size: '7B', quantization: 'Q4_K_M' },
    { id: 'codegemma', name: 'CodeGemma 7B', size: '7B', quantization: 'Q4_K_M' },
    { id: 'phi3', name: 'Phi-3 Mini', size: '3.8B', quantization: 'Q4_K_M' },
    { id: 'llama3:70b', name: 'Llama 3 70B', size: '70B', quantization: 'Q4_K_M' },
  ];

  return (
    <div className="ollama-settings">
      <h2>Ollama Einstellungen</h2>

      <div className="setting-item">
        <label>
          Ollama Server URL:
          <input type="text" value="http://localhost:11434" />
        </label>
        <p className="setting-description">
          URL des Ollama-Servers (Standard: http://localhost:11434)
        </p>
      </div>

      <div className="setting-item">
        <label>
          Standard-Modell:
          <select value="llama3">
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.name} ({model.size}, {model.quantization})
              </option>
            ))}
          </select>
        </label>
        <p className="setting-description">
          Standard-Modell für Ollama-Anfragen
        </p>
      </div>

      <div className="setting-item">
        <label>
          Kontext-Fenster:
          <input type="number" value={4096} min={512} max={16384} />
        </label>
        <p className="setting-description">
          Maximale Anzahl an Tokens im Kontext-Fenster
        </p>
      </div>

      <div className="setting-item">
        <label>
          <input type="checkbox" checked={true} />
          Caching aktivieren
        </label>
        <p className="setting-description">
          Aktiviere Caching für Anfragen, um Token zu sparen
        </p>
      </div>

      <div className="setting-actions">
        <button className="btn-primary">Modelle aktualisieren</button>
        <button className="btn-secondary">Cache leeren</button>
        <button className="btn-save">Speichern</button>
      </div>

      <h3>Verfügbare Modelle</h3>
      <div className="models-table">
        <table>
          <thead>
            <tr>
              <th>Modell</th>
              <th>Größe</th>
              <th>Quantisierung</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {models.map(model => (
              <tr key={model.id}>
                <td>{model.name}</td>
                <td>{model.size}</td>
                <td>{model.quantization}</td>
                <td>
                  <button className="btn-small">Als Standard setzen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Modell hinzufügen</h3>
      <div className="add-model-form">
        <div className="form-row">
          <label>Modell-Name:</label>
          <input type="text" placeholder="z.B. mistral:latest" />
        </div>
        <button className="btn-primary">Modell herunterladen</button>
      </div>
    </div>
  );
};

// Export der Komponenten
export { OllamaSettings };