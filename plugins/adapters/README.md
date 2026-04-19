# OpenCognit Adapter Plugins

Externe Adapter können hier als eigenständige Ordner abgelegt werden. Beim
Server-Start scannt OpenCognit dieses Verzeichnis und lädt jeden gültigen
Adapter in die Registry.

## Ordner-Struktur

```
plugins/adapters/
  my-llm/
    plugin.json
    index.js
```

## plugin.json

```json
{
  "name": "my-llm",
  "version": "1.0.0",
  "description": "Adapter für MyLLM",
  "author": "you@example.com",
  "main": "index.js"
}
```

`name` darf nicht mit einem Core-Adapter kollidieren
(`bash`, `http`, `claude-code`, `codex-cli`, `gemini-cli`, `openclaw`).

## index.js

Muss eine Factory als `default` oder `createAdapter` exportieren. Die
Factory bekommt einen kleinen Context (`log`) und liefert ein Objekt,
das das Adapter-Interface erfüllt:

```js
export default function createAdapter(ctx) {
  return {
    name: 'my-llm',

    canHandle(task) {
      // true wenn dieser Adapter den Task ausführen soll.
      return false;
    },

    async execute(task, context, config) {
      ctx.log(`running task: ${task.titel}`);
      // ... tatsächliche Ausführung ...
      return {
        success: true,
        output: 'done',
        exitCode: 0,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: 0,
      };
    },
  };
}
```

Fehler beim Laden eines einzelnen Plugins blockieren den Server-Start **nicht** —
sie werden nur geloggt.

## Inspektion

```
GET /api/adapters
```

Liefert alle registrierten Adapter + geladene Plugin-Metadaten.
