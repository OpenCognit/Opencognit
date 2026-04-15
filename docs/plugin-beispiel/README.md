# Beispiel-Plugin für OpenCognit

Dieses Plugin dient als Beispiel für die Entwicklung von Plugins für OpenCognit. Es demonstriert die grundlegenden Funktionen und Möglichkeiten des Plugin-Frameworks.

## Funktionen

- Dashboard-Widget zur Anzeige von Plugin-Statistiken
- Einstellungsseite für Plugin-Konfiguration
- Ereignisverarbeitung und Benachrichtigungen
- API-Endpunkte für Plugin-Funktionen

## Installation

1. Kopiere das Plugin-Verzeichnis nach `/home/panto/CODING/OpenCognit/data/plugins/opencognit-example-plugin/`
2. Starte den OpenCognit-Server neu
3. Aktiviere das Plugin über die Einstellungen

## Konfiguration

Das Plugin bietet folgende Konfigurationsoptionen:

- **enableNotifications**: Aktiviert/deaktiviert Benachrichtigungen
- **notificationSound**: Sound für Benachrichtigungen (ping, ding, chime, none)
- **refreshInterval**: Aktualisierungsintervall in Sekunden (10-3600)

## API-Endpunkte

Das Plugin stellt folgende API-Endpunkte bereit:

- **GET /api/plugins/example/stats**: Ruft die aktuellen Plugin-Statistiken ab
- **POST /api/plugins/example/reset-stats**: Setzt die Plugin-Statistiken zurück

## UI-Komponenten

Das Plugin fügt folgende UI-Komponenten hinzu:

- **Dashboard-Widget**: Zeigt Plugin-Statistiken an
- **Einstellungsseite**: Ermöglicht die Konfiguration des Plugins

## Entwicklung

Dieses Plugin kann als Vorlage für eigene Plugins dienen. Es zeigt, wie ein Plugin:

- Metadaten und Konfiguration definiert
- UI-Komponenten registriert
- Event-Handler für OpenCognit-Ereignisse implementiert
- API-Endpunkte bereitstellt
- Persistenz für Plugin-Daten implementiert

## Lizenz

MIT