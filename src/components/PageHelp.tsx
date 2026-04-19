import { useState } from 'react';
import { HelpCircle, X, ChevronDown, ChevronUp, LucideIcon } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HelpItem {
  icon: string;   // emoji — keeps the component dependency-free from lucide
  heading: string;
  text: string;
}

export interface HelpContent {
  intro: string;
  items: HelpItem[];
  tip?: string;
}

// ─── Content registry ─────────────────────────────────────────────────────────

type PageId =
  | 'agents' | 'tasks' | 'goals' | 'projects' | 'intelligence'
  | 'costs' | 'routines' | 'approvals' | 'meetings' | 'orgchart'
  | 'skill-library' | 'activity' | 'settings' | 'dashboard' | 'focus'
  | 'plugins' | 'workers';

const CONTENT: Record<PageId, { de: HelpContent; en: HelpContent }> = {

  dashboard: {
    de: {
      intro: 'Das Dashboard zeigt dir den Echtzeit-Status deines gesamten AI-Teams — aktive Agenten, offene Aufgaben, Budget-Verbrauch und Health Score.',
      items: [
        { icon: '🤖', heading: 'Agenten', text: 'Jeder Agent ist ein eigenständiger KI-Mitarbeiter. Der grüne Punkt bedeutet "aktiv", Blitz bedeutet "läuft gerade".' },
        { icon: '📋', heading: 'Health Score', text: 'Ein Score von 0–100 bewertet den Zustand deines Teams: Fehler, blockierte Tasks und Budget-Verbrauch senken ihn.' },
        { icon: '🔔', heading: 'Genehmigungen', text: 'Agenten im Copilot-Modus fragen vor Aktionen nach Freigabe. Der gelbe Button zeigt ausstehende Anfragen.' },
        { icon: '🎖', heading: 'War Room', text: 'Live-Ansicht aller Agenten auf einem Screen. Ideal wenn du beobachten willst, was gerade passiert.' },
      ],
      tip: 'Tipp: Klick auf einen Agenten im Dashboard um direkt mit ihm zu chatten oder seine Aktivitäten zu sehen.',
    },
    en: {
      intro: 'The dashboard shows you the real-time status of your entire AI team — active agents, open tasks, budget usage, and health score.',
      items: [
        { icon: '🤖', heading: 'Agents', text: 'Each agent is an autonomous AI worker. Green dot means "active", lightning bolt means "running now".' },
        { icon: '📋', heading: 'Health Score', text: 'A 0–100 score rates your team\'s health: errors, blocked tasks, and budget usage lower it.' },
        { icon: '🔔', heading: 'Approvals', text: 'Agents in Copilot mode ask for approval before actions. The yellow button shows pending requests.' },
        { icon: '🎖', heading: 'War Room', text: 'Live view of all agents on one screen. Ideal when you want to watch what\'s happening right now.' },
      ],
      tip: 'Tip: Click an agent in the dashboard to chat with it directly or see its activity.',
    },
  },

  agents: {
    de: {
      intro: 'Agenten sind deine KI-Mitarbeiter. Jeder bekommt eine Rolle, ein LLM (Claude, GPT-4, Ollama…) und Skills. Über den Auto-Zyklus arbeiten sie vollständig selbständig.',
      items: [
        { icon: '🔄', heading: 'Auto-Zyklus', text: 'Ist der Zyklus aktiv, wacht der Agent alle N Sekunden auf, liest seine Aufgaben und handelt — ohne dass du etwas tun musst.' },
        { icon: '🔗', heading: 'Verbindungstyp', text: 'Wähle welches LLM der Agent nutzt: Anthropic (Claude), OpenRouter (GPT-4, Mistral…), Ollama (lokal), Claude Code CLI oder eigene HTTP-Endpoints.' },
        { icon: '🛡', heading: 'Autonomie-Level', text: 'Copilot = nur Vorschläge. Teamplayer = darf lesen & Tasks anlegen. Autopilot = vollständige Autonomie ohne Rückfragen.' },
        { icon: '👑', heading: 'Orchestrator', text: 'Ein Orchestrator-Agent ist der Team-Lead: Er delegiert Aufgaben, ruft Meetings ein und koordiniert andere Agenten.' },
        { icon: '💬', heading: 'Chat', text: 'Klicke auf einen Agenten um direkt mit ihm zu sprechen. Du bekommst sofort eine Antwort über den direkten LLM-Kanal.' },
        { icon: '💰', heading: 'Budget', text: 'Setze ein monatliches Kostenlimit. Bei 100% wird der Agent automatisch pausiert (außer im Maximizer-Modus).' },
      ],
      tip: 'Tipp: Starte mit einem einfachen Agenten (Rolle: "Assistent", Verbindung: OpenRouter) bevor du Orchestratoren und Hierarchien aufbaust.',
    },
    en: {
      intro: 'Agents are your AI workers. Each gets a role, an LLM (Claude, GPT-4, Ollama…) and skills. Via auto-cycle they work completely autonomously.',
      items: [
        { icon: '🔄', heading: 'Auto-cycle', text: 'When the cycle is active, the agent wakes up every N seconds, reads its tasks and acts — without you doing anything.' },
        { icon: '🔗', heading: 'Connection type', text: 'Choose which LLM the agent uses: Anthropic (Claude), OpenRouter (GPT-4, Mistral…), Ollama (local), Claude Code CLI, or custom HTTP endpoints.' },
        { icon: '🛡', heading: 'Autonomy level', text: 'Copilot = suggestions only. Teamplayer = can read & create tasks. Autopilot = full autonomy without check-ins.' },
        { icon: '👑', heading: 'Orchestrator', text: 'An orchestrator agent is the team lead: it delegates tasks, calls meetings, and coordinates other agents.' },
        { icon: '💬', heading: 'Chat', text: 'Click an agent to speak with it directly. You get an instant response via the direct LLM channel.' },
        { icon: '💰', heading: 'Budget', text: 'Set a monthly cost limit. At 100% the agent is automatically paused (except in Maximizer mode).' },
      ],
      tip: 'Tip: Start with a simple agent (role: "Assistant", connection: OpenRouter) before building orchestrators and hierarchies.',
    },
  },

  tasks: {
    de: {
      intro: 'Aufgaben sind die Arbeitspakete deiner Agenten. Erstelle eine Aufgabe, weise sie zu — der Agent bearbeitet sie im nächsten Zyklus eigenständig und hält dich via Chat auf dem Laufenden.',
      items: [
        { icon: '📥', heading: 'Inbox-Prinzip', text: 'Der Agent liest bei jedem Zyklus alle ihm zugewiesenen Aufgaben. Er entscheidet selbst was er als nächstes angeht.' },
        { icon: '🚦', heading: 'Status-Flow', text: 'todo → in_progress → done. Agenten aktualisieren den Status selbst über die update_task_status-Aktion.' },
        { icon: '⚡', heading: 'Maximizer-Modus', text: 'Aktivierst du ihn für eine Aufgabe, ignoriert der Agent sein Budget-Limit und arbeitet mit maximaler Intensität bis die Aufgabe erledigt ist.' },
        { icon: '🔒', heading: 'Genehmigungen', text: 'Agenten im Copilot- oder Teamplayer-Modus müssen bestimmte Aktionen genehmigen lassen bevor sie ausgeführt werden.' },
        { icon: '🔗', heading: 'Abhängigkeiten', text: 'Aufgaben können sich gegenseitig blockieren. Ein Agent kann add_dependency nutzen um Reihenfolgen zu definieren.' },
        { icon: '📁', heading: 'Workspace-Pfad', text: 'Gib einem Task einen Arbeitsordner mit. Der Agent liest und schreibt dann ausschließlich in diesem Verzeichnis.' },
      ],
      tip: 'Tipp: Schreibe Aufgabenbeschreibungen so präzise wie möglich — der Agent hat nur diese Information als Ausgangspunkt.',
    },
    en: {
      intro: 'Tasks are your agents\' work items. Create a task, assign it — the agent handles it in the next cycle and keeps you updated via chat.',
      items: [
        { icon: '📥', heading: 'Inbox principle', text: 'The agent reads all assigned tasks on each cycle. It decides what to tackle next on its own.' },
        { icon: '🚦', heading: 'Status flow', text: 'todo → in_progress → done. Agents update the status themselves via the update_task_status action.' },
        { icon: '⚡', heading: 'Maximizer mode', text: 'Activate it for a task and the agent ignores its budget limit, working at maximum intensity until done.' },
        { icon: '🔒', heading: 'Approvals', text: 'Agents in Copilot or Teamplayer mode need certain actions approved before execution.' },
        { icon: '🔗', heading: 'Dependencies', text: 'Tasks can block each other. An agent can use add_dependency to define ordering.' },
        { icon: '📁', heading: 'Workspace path', text: 'Give a task a working directory. The agent will then exclusively read and write in that folder.' },
      ],
      tip: 'Tip: Write task descriptions as precisely as possible — that\'s the only starting information the agent has.',
    },
  },

  goals: {
    de: {
      intro: 'Ziele (OKRs) sind übergeordnete Vorhaben, die automatisch in Sub-Aufgaben für deine Agenten heruntergebrochen werden. Ein Ziel ist erledigt wenn alle seine Aufgaben abgeschlossen sind.',
      items: [
        { icon: '🎯', heading: 'Ziel → Aufgaben', text: 'Wenn du ein Ziel erstellst, werden automatisch verknüpfte Tasks generiert und an geeignete Agenten verteilt.' },
        { icon: '📊', heading: 'Fortschritt', text: 'Der Fortschrittsbalken zeigt wie viele der verknüpften Aufgaben erledigt sind. Bei 100% ist das Ziel erreicht.' },
        { icon: '🏢', heading: 'Unternehmens-Ebene', text: 'Ziele sind auf Company-Ebene definiert — alle Agenten arbeiten gemeinsam daran.' },
        { icon: '🔔', heading: 'Benachrichtigung', text: 'Wenn ein Ziel 100% erreicht, bekommst du eine Toast-Benachrichtigung und die Agenten werden informiert.' },
      ],
      tip: 'Tipp: Formuliere Ziele als messbare Ergebnisse: "Deploye Version 2.0 mit Feature X bis Ende April" statt "Entwickle neue Features".',
    },
    en: {
      intro: 'Goals (OKRs) are high-level objectives that automatically break down into sub-tasks for your agents. A goal is complete when all its tasks are done.',
      items: [
        { icon: '🎯', heading: 'Goal → Tasks', text: 'When you create a goal, linked tasks are automatically generated and distributed to suitable agents.' },
        { icon: '📊', heading: 'Progress', text: 'The progress bar shows how many linked tasks are completed. At 100% the goal is achieved.' },
        { icon: '🏢', heading: 'Company level', text: 'Goals are defined at company level — all agents work on them together.' },
        { icon: '🔔', heading: 'Notification', text: 'When a goal reaches 100%, you get a toast notification and agents are informed.' },
      ],
      tip: 'Tip: Phrase goals as measurable outcomes: "Deploy v2.0 with feature X by end of April" instead of "Develop new features".',
    },
  },

  projects: {
    de: {
      intro: 'Projekte gruppieren zusammengehörige Aufgaben. Sie geben Agenten und dir einen klaren Kontext über den Umfang einer Arbeit.',
      items: [
        { icon: '📂', heading: 'Aufgaben-Gruppen', text: 'Ein Projekt sammelt alle Tasks die zu einem Vorhaben gehören — unabhängig davon welcher Agent sie bearbeitet.' },
        { icon: '📅', heading: 'Deadline', text: 'Setze eine Deadline. Agenten sehen das Datum in ihrem Kontext und können Prioritäten anpassen.' },
        { icon: '📈', heading: 'Timeline', text: 'Die Timeline zeigt den zeitlichen Verlauf aller Aufgaben im Projekt visuell.' },
        { icon: '🔗', heading: 'Verknüpfungen', text: 'Projekte können mit Zielen verknüpft werden um den strategischen Kontext herzustellen.' },
      ],
      tip: 'Tipp: Ein Projekt pro Feature/Meilenstein — nicht ein Mega-Projekt für alles.',
    },
    en: {
      intro: 'Projects group related tasks. They give agents and you clear context about the scope of a piece of work.',
      items: [
        { icon: '📂', heading: 'Task groups', text: 'A project collects all tasks belonging to an initiative — regardless of which agent handles them.' },
        { icon: '📅', heading: 'Deadline', text: 'Set a deadline. Agents see the date in their context and can adjust priorities.' },
        { icon: '📈', heading: 'Timeline', text: 'The timeline shows the chronological flow of all tasks in the project visually.' },
        { icon: '🔗', heading: 'Connections', text: 'Projects can be linked to goals to establish the strategic context.' },
      ],
      tip: 'Tip: One project per feature/milestone — not one mega-project for everything.',
    },
  },

  intelligence: {
    de: {
      intro: 'Intelligence ist das persistente Gedächtnis (Memory) deiner Agenten. Hier speichern und lesen sie Wissen, Entscheidungen und Skills — automatisch und kontextbezogen.',
      items: [
        { icon: '🧠', heading: 'Memory', text: 'Agenten schreiben automatisch alle 15 Zyklen wichtige Erkenntnisse in ihr Gedächtnis. Du kannst es hier durchsuchen.' },
        { icon: '🔗', heading: 'Knowledge Graph', text: 'Fakten werden als Tripel gespeichert: Subjekt → Prädikat → Objekt. Ermöglicht semantische Abfragen.' },
        { icon: '📖', heading: 'Tagebuch (Diary)', text: 'Jeder Agent führt ein strukturiertes Tagebuch: Gedanken, Aktionen, Erkenntnisse — mit Datum und Kontext.' },
        { icon: '🧬', heading: 'Learning Loop', text: 'Agenten taggen wiederverwendbare Lösungen als Skills ([SKILL:Name]). Diese werden gespeichert und beim nächsten passenden Task automatisch eingebettet.' },
        { icon: '🔍', heading: 'RAG-Injection', text: 'Beim Starten eines Zyklus werden die relevantesten Erinnerungen automatisch in den Kontext geladen — basierend auf den aktuellen Aufgaben-Keywords.' },
        { icon: '📊', heading: 'Health Score', text: 'Zeigt die Qualität des Agentengedächtnisses. Hohe Konfidenz = gut eingespielte Skills und akkurate Erinnerungen.' },
      ],
      tip: 'Tipp: Agenten können mit memory_search gezielt im Gedächtnis suchen und mit memory_diary_write Entscheidungen dokumentieren.',
    },
    en: {
      intro: 'Intelligence is your agents\' persistent memory (Memory). Here they store and read knowledge, decisions, and skills — automatically and contextually.',
      items: [
        { icon: '🧠', heading: 'Memory', text: 'Agents automatically write important insights to memory every 15 cycles. You can search it here.' },
        { icon: '🔗', heading: 'Knowledge Graph', text: 'Facts are stored as triples: subject → predicate → object. Enables semantic queries.' },
        { icon: '📖', heading: 'Diary', text: 'Each agent keeps a structured diary: thoughts, actions, insights — with date and context.' },
        { icon: '🧬', heading: 'Learning Loop', text: 'Agents tag reusable solutions as skills ([SKILL:Name]). These are stored and automatically embedded on the next matching task.' },
        { icon: '🔍', heading: 'RAG injection', text: 'When a cycle starts, the most relevant memories are automatically loaded into context — based on current task keywords.' },
        { icon: '📊', heading: 'Health Score', text: 'Shows the quality of agent memory. High confidence = well-established skills and accurate memories.' },
      ],
      tip: 'Tip: Agents can use memory_search to specifically search memory and memory_diary_write to document decisions.',
    },
  },

  costs: {
    de: {
      intro: 'Kosten werden pro Agent, Aufruf und Monat getrackt. Jedes LLM-Request wird mit echten Token-Preisen verbucht. Setze Limits um Überraschungen zu vermeiden.',
      items: [
        { icon: '💳', heading: 'Buchungen', text: 'Jeder LLM-Aufruf erzeugt eine Kostenbuchung mit Input-Tokens, Output-Tokens und Cent-Betrag.' },
        { icon: '🎯', heading: 'Budget-Limit', text: 'Setze ein monatliches Limit pro Agent (in den Agent-Einstellungen). Bei 100% wird der Agent automatisch pausiert.' },
        { icon: '⚡', heading: 'Maximizer-Modus', text: 'Im Maximizer-Modus ignoriert ein Agent sein Budget-Limit bewusst um eine kritische Aufgabe zu Ende zu bringen.' },
        { icon: '📊', heading: 'Trends', text: 'Das Diagramm zeigt Kosten nach Anbieter und Agent — so erkennst du wer am teuersten ist.' },
        { icon: '💡', heading: 'Spare Geld', text: 'Nutze Ollama für einfache Tasks (kostenlos, lokal), OpenRouter für komplexe (günstigere Modelle möglich).' },
      ],
      tip: 'Tipp: Setze das Budget für Worker-Agenten niedrig (z.B. 5€) und nur für den Orchestrator höher — der koordiniert, die Worker führen aus.',
    },
    en: {
      intro: 'Costs are tracked per agent, call, and month. Each LLM request is booked at real token prices. Set limits to avoid surprises.',
      items: [
        { icon: '💳', heading: 'Bookings', text: 'Each LLM call creates a cost booking with input tokens, output tokens, and cent amount.' },
        { icon: '🎯', heading: 'Budget limit', text: 'Set a monthly limit per agent (in agent settings). At 100% the agent is automatically paused.' },
        { icon: '⚡', heading: 'Maximizer mode', text: 'In Maximizer mode, an agent deliberately ignores its budget limit to finish a critical task.' },
        { icon: '📊', heading: 'Trends', text: 'The chart shows costs by provider and agent — so you can see who\'s most expensive.' },
        { icon: '💡', heading: 'Save money', text: 'Use Ollama for simple tasks (free, local), OpenRouter for complex ones (cheaper models possible).' },
      ],
      tip: 'Tip: Set budget low for worker agents (e.g. €5) and higher only for the orchestrator — it coordinates, workers execute.',
    },
  },

  routines: {
    de: {
      intro: 'Routinen sind Cron-Trigger, die Agenten zu festgelegten Zeiten aufwecken. Perfekt für regelmäßige Workflows: tägliche Reports, wöchentliche Reviews, stündliche Checks.',
      items: [
        { icon: '⏰', heading: 'Cron-Syntax', text: 'Nutze Standard-5-Feld-Cron: "0 9 * * 1-5" = werktags um 9 Uhr. "*/30 * * * *" = alle 30 Minuten.' },
        { icon: '🤖', heading: 'Ziel-Agent', text: 'Jede Routine weckt einen bestimmten Agenten auf. Der Agent führt dann seinen normalen Arbeitszyklus aus.' },
        { icon: '🔗', heading: 'Trigger-Arten', text: 'Cron (zeitgesteuert), Event (bei bestimmtem Ereignis), Webhook (externer Aufruf), Manuell (On-Demand).' },
        { icon: '📋', heading: 'Ausführungs-Log', text: 'Jede Ausführung wird geloggt: wann, Ergebnis, Dauer. So siehst du ob Routinen zuverlässig laufen.' },
      ],
      tip: 'Tipp: Verbinde eine Routine mit einem Daily-Standup-Task für den Orchestrator — dann erstellt er jeden Morgen um 8:30 eine Zusammenfassung.',
    },
    en: {
      intro: 'Routines are cron triggers that wake agents at set times. Perfect for recurring workflows: daily reports, weekly reviews, hourly checks.',
      items: [
        { icon: '⏰', heading: 'Cron syntax', text: 'Use standard 5-field cron: "0 9 * * 1-5" = weekdays at 9am. "*/30 * * * *" = every 30 minutes.' },
        { icon: '🤖', heading: 'Target agent', text: 'Each routine wakes up a specific agent. The agent then runs its normal work cycle.' },
        { icon: '🔗', heading: 'Trigger types', text: 'Cron (time-based), Event (on specific event), Webhook (external call), Manual (on-demand).' },
        { icon: '📋', heading: 'Execution log', text: 'Each execution is logged: when, result, duration. So you can see if routines are running reliably.' },
      ],
      tip: 'Tip: Connect a routine to a daily standup task for the orchestrator — then it creates a summary every morning at 8:30.',
    },
  },

  approvals: {
    de: {
      intro: 'Agenten im Copilot- oder Teamplayer-Modus fragen vor kritischen Aktionen nach deiner Genehmigung. Hier kannst du sie freigeben oder ablehnen.',
      items: [
        { icon: '🛡', heading: 'Warum Genehmigungen?', text: 'Sicherheitsnetz: Bevor ein Agent eine Datei schreibt, einen Task ändert oder einen Agenten einstellt, zeigt er dir was er vorhat.' },
        { icon: '✅', heading: 'Freigeben', text: 'Genehmigst du, führt der Agent die Aktion sofort aus und fährt mit seiner Arbeit fort.' },
        { icon: '❌', heading: 'Ablehnen', text: 'Lehnst du ab, wird die Aktion übersprungen. Der Agent bekommt eine System-Nachricht und kann einen anderen Weg wählen.' },
        { icon: '⚡', heading: 'Autopilot', text: 'Im Autopilot-Modus braucht ein Agent keine Genehmigungen mehr — er handelt vollständig selbständig.' },
      ],
      tip: 'Tipp: Starte neue Agenten im Copilot-Modus, beobachte ihre Aktionen ein paar Tage, und schalte dann auf Autopilot wenn du ihnen vertraust.',
    },
    en: {
      intro: 'Agents in Copilot or Teamplayer mode ask for your approval before critical actions. Here you can approve or reject them.',
      items: [
        { icon: '🛡', heading: 'Why approvals?', text: 'Safety net: before an agent writes a file, changes a task, or hires an agent, it shows you what it\'s planning.' },
        { icon: '✅', heading: 'Approve', text: 'If you approve, the agent executes the action immediately and continues its work.' },
        { icon: '❌', heading: 'Reject', text: 'If you reject, the action is skipped. The agent gets a system message and can choose a different path.' },
        { icon: '⚡', heading: 'Autopilot', text: 'In Autopilot mode, an agent no longer needs approvals — it acts completely autonomously.' },
      ],
      tip: 'Tip: Start new agents in Copilot mode, watch their actions for a few days, then switch to Autopilot when you trust them.',
    },
  },

  meetings: {
    de: {
      intro: 'Meetings sind synchrone Abstimmungen zwischen mehreren Agenten. Ein Agent stellt eine Frage an das Team — alle antworten gleichzeitig, dann wird eine Zusammenfassung erstellt.',
      items: [
        { icon: '📋', heading: 'Meeting starten', text: 'Ein Agent ruft call_meeting auf mit einer Frage und einer Liste von Agenten-IDs. Alle werden gleichzeitig geweckt.' },
        { icon: '💬', heading: 'Antworten', text: 'Jeder Teilnehmer antwortet mit seiner Einschätzung. Nach der letzten Antwort wird das Meeting als "abgeschlossen" markiert.' },
        { icon: '🧩', heading: 'Synthese', text: 'Der Meeting-Veranstalter bekommt alle Antworten und erstellt eine Zusammenfassung für das Board.' },
        { icon: '🔗', heading: 'P2P-Nachrichten', text: 'Neben Meetings gibt es auch 1:1-Nachrichten zwischen Agenten (chat mit empfaenger-Parameter).' },
      ],
      tip: 'Tipp: Meetings eignen sich gut für Entscheidungen die mehrere Perspektiven brauchen: "Sollen wir Feature X priorisieren?"',
    },
    en: {
      intro: 'Meetings are synchronous discussions between multiple agents. One agent asks the team a question — all answer simultaneously, then a synthesis is created.',
      items: [
        { icon: '📋', heading: 'Start a meeting', text: 'An agent calls call_meeting with a question and a list of agent IDs. All are woken up simultaneously.' },
        { icon: '💬', heading: 'Responses', text: 'Each participant responds with their assessment. After the last answer, the meeting is marked "completed".' },
        { icon: '🧩', heading: 'Synthesis', text: 'The meeting organizer receives all answers and creates a summary for the board.' },
        { icon: '🔗', heading: 'P2P messages', text: 'Besides meetings there are also 1:1 messages between agents (chat with recipient parameter).' },
      ],
      tip: 'Tip: Meetings work well for decisions that need multiple perspectives: "Should we prioritize feature X?"',
    },
  },

  orgchart: {
    de: {
      intro: 'Das Org-Chart zeigt die Hierarchie deines AI-Teams. Wer berichtet an wen? Orchestratoren stehen oben und koordinieren ihre direkten Berichte.',
      items: [
        { icon: '👑', heading: 'Orchestrator', text: 'Ein Agent mit Orchestrator-Flag ist Team-Lead. Er sieht die Status seiner direkten Berichte und delegiert Aufgaben.' },
        { icon: '📊', heading: 'Hierarchie', text: 'Agenten haben ein "reportsTo"-Feld. So baust du Strukturen auf: CEO → Manager → Entwickler.' },
        { icon: '🔄', heading: 'Delegation', text: 'Ein Orchestrator kann delegate_task nutzen um eine Aufgabe direkt an einen bestimmten Agenten zu übergeben.' },
        { icon: '📡', heading: 'Wakeup-Chain', text: 'Wenn ein Orchestrator eine Aufgabe delegiert, wird der Ziel-Agent sofort geweckt und bekommt ein Briefing.' },
      ],
      tip: 'Tipp: Halte die Hierarchie flach — 2 Ebenen (Orchestrator + Worker) reichen für die meisten Teams.',
    },
    en: {
      intro: 'The org chart shows your AI team\'s hierarchy. Who reports to whom? Orchestrators sit at the top and coordinate their direct reports.',
      items: [
        { icon: '👑', heading: 'Orchestrator', text: 'An agent with the orchestrator flag is team lead. It sees its direct reports\' statuses and delegates tasks.' },
        { icon: '📊', heading: 'Hierarchy', text: 'Agents have a "reportsTo" field. Build structures like: CEO → Manager → Developer.' },
        { icon: '🔄', heading: 'Delegation', text: 'An orchestrator can use delegate_task to directly hand a task to a specific agent.' },
        { icon: '📡', heading: 'Wakeup chain', text: 'When an orchestrator delegates a task, the target agent is immediately woken and gets a briefing.' },
      ],
      tip: 'Tip: Keep the hierarchy flat — 2 levels (orchestrator + workers) are enough for most teams.',
    },
  },

  'skill-library': {
    de: {
      intro: 'Die Skill Library ist das kollektive Wissen deines Teams. Agenten lernen automatisch neue Skills aus ihrer Arbeit (Learning Loop) und nutzen sie beim nächsten passenden Task.',
      items: [
        { icon: '🧬', heading: 'Learning Loop', text: 'Wenn ein Agent eine wiederverwendbare Lösung findet, taggt er sie mit [SKILL:Name]...Inhalt...[/SKILL:Name]. Das System speichert sie automatisch.' },
        { icon: '🔍', heading: 'RAG-Matching', text: 'Beim Starten eines Zyklus werden Skills nach Relevanz gescort (Keyword-Overlap mit aktuellen Tasks). Die Top-5 werden in den Kontext geladen.' },
        { icon: '📈', heading: 'Konfidenz', text: 'Jeder Skill hat einen Konfidenz-Score (0–100). Bei häufiger Nutzung steigt er, bei Fehlern sinkt er. Schlechte Skills werden automatisch deprecated.' },
        { icon: '✏️', heading: 'Manuell erstellen', text: 'Du kannst auch eigene Skills erstellen: Workflow-Dokumentation, Unternehmens-Standards, Code-Templates — alles was Agenten wissen sollen.' },
      ],
      tip: 'Tipp: Erstelle einen "Company Guidelines" Skill mit Konventionen, Technologie-Stack und wichtigen Regeln — alle Agenten profitieren davon.',
    },
    en: {
      intro: 'The Skill Library is your team\'s collective knowledge. Agents automatically learn new skills from their work (Learning Loop) and use them on the next matching task.',
      items: [
        { icon: '🧬', heading: 'Learning Loop', text: 'When an agent finds a reusable solution, it tags it with [SKILL:Name]...content...[/SKILL:Name]. The system stores it automatically.' },
        { icon: '🔍', heading: 'RAG matching', text: 'When a cycle starts, skills are scored by relevance (keyword overlap with current tasks). The top 5 are loaded into context.' },
        { icon: '📈', heading: 'Confidence', text: 'Each skill has a confidence score (0–100). It rises with frequent use, drops on failures. Bad skills are automatically deprecated.' },
        { icon: '✏️', heading: 'Create manually', text: 'You can also create your own skills: workflow documentation, company standards, code templates — anything agents should know.' },
      ],
      tip: 'Tip: Create a "Company Guidelines" skill with conventions, tech stack, and key rules — all agents benefit from it.',
    },
  },

  activity: {
    de: {
      intro: 'Das Aktivitätslog zeigt alles was in deinem AI-Team passiert — in Echtzeit. Ideal zum Debuggen, Nachvollziehen und Verstehen der Agenten-Aktionen.',
      items: [
        { icon: '📡', heading: 'Echtzeit', text: 'Das Log wird live via WebSocket aktualisiert. Du siehst Aktionen im Millisekunden-Bereich nach ihrer Ausführung.' },
        { icon: '🔍', heading: 'Trace-Typen', text: 'thinking = Agent denkt nach. action = Agent handelt. result = Ergebnis einer Aktion. error = Fehler. info = System-Info.' },
        { icon: '🤖', heading: 'Pro Agent', text: 'Filtere nach einem bestimmten Agenten um nur seine Aktionen zu sehen. Hilfreich wenn du einen Agent debuggen willst.' },
        { icon: '⚠️', heading: 'Fehler erkennen', text: 'Rote Einträge (error) zeigen Probleme. Häufige Fehler = falscher API-Key, Verbindungsproblem oder fehlende Permissions.' },
      ],
      tip: 'Tipp: Öffne den War Room für eine visuelle Live-Ansicht — das Activity Log ist gut für detaillierte Text-Traces.',
    },
    en: {
      intro: 'The activity log shows everything happening in your AI team — in real-time. Ideal for debugging, tracing, and understanding agent actions.',
      items: [
        { icon: '📡', heading: 'Real-time', text: 'The log updates live via WebSocket. You see actions milliseconds after execution.' },
        { icon: '🔍', heading: 'Trace types', text: 'thinking = agent is reasoning. action = agent is acting. result = outcome of an action. error = failure. info = system info.' },
        { icon: '🤖', heading: 'Per agent', text: 'Filter by a specific agent to see only its actions. Helpful when debugging an agent.' },
        { icon: '⚠️', heading: 'Spot errors', text: 'Red entries (error) indicate problems. Frequent errors = wrong API key, connection issue, or missing permissions.' },
      ],
      tip: 'Tip: Open the War Room for a visual live view — the activity log is better for detailed text traces.',
    },
  },

  settings: {
    de: {
      intro: 'In den Einstellungen konfigurierst du API-Schlüssel, Messaging-Kanäle (Telegram) und globale Unternehmens-Parameter.',
      items: [
        { icon: '🔑', heading: 'API-Schlüssel', text: 'Hinterlege Schlüssel für OpenRouter, Anthropic, OpenAI. Ohne gültigen Key kann ein Agent nicht laufen.' },
        { icon: '📱', heading: 'Telegram', text: 'Verbinde Telegram um Benachrichtigungen zu erhalten wenn Tasks erledigt werden oder Fehler auftreten.' },
        { icon: '🏢', heading: 'Unternehmen', text: 'Name, Beschreibung und Ziel werden Agenten als Kontext mitgegeben — formuliere sie präzise.' },
        { icon: '🌍', heading: 'Sprache', text: 'DE/EN wechselt die UI-Sprache. Agenten antworten standardmäßig in der Sprache des Board-Users.' },
        { icon: '📁', heading: 'Arbeitsverzeichnis', text: 'Das globale Arbeitsverzeichnis ist der Standard-Workspace aller Agenten für Dateioperationen.' },
      ],
      tip: 'Tipp: Trage im Unternehmens-Ziel-Feld kurz ein was dein Unternehmen macht — dann haben alle Agenten immer den richtigen Kontext.',
    },
    en: {
      intro: 'In settings you configure API keys, messaging channels (Telegram), and global company parameters.',
      items: [
        { icon: '🔑', heading: 'API keys', text: 'Add keys for OpenRouter, Anthropic, OpenAI. Without a valid key an agent cannot run.' },
        { icon: '📱', heading: 'Telegram', text: 'Connect Telegram to receive notifications when tasks complete or errors occur.' },
        { icon: '🏢', heading: 'Company', text: 'Name, description and goal are given to agents as context — phrase them precisely.' },
        { icon: '🌍', heading: 'Language', text: 'DE/EN switches the UI language. Agents respond by default in the board user\'s language.' },
        { icon: '📁', heading: 'Working directory', text: 'The global working directory is the default workspace for all agents\' file operations.' },
      ],
      tip: 'Tip: Enter in the company goal field what your company does — then all agents always have the right context.',
    },
  },

  plugins: {
    de: {
      intro: 'Plugins erweitern OpenCognit um neue LLM-Provider, Tools und Integrationen — ohne die Core-Codebase anzufassen. Durchsuche das Registry, installiere per Klick, Hot-Reload ohne Server-Neustart.',
      items: [
        { icon: '🔌', heading: 'Was sind Plugins?', text: 'Adapter-Pakete die neue Fähigkeiten registrieren: weitere LLMs (z.B. Groq, Mistral-API), domänenspezifische Tools (GitHub, Slack, Jira) oder Output-Formatter.' },
        { icon: '📦', heading: 'Registry', text: 'Der Registry zeigt verfügbare Plugins mit Version, Tags und Quelle. Standard-Registry ist das offizielle OpenCognit-Repo — du kannst aber jede Registry-URL angeben.' },
        { icon: '🛡', heading: 'Sicherheit', text: 'Tarball-Plugins werden per SHA-256-Hash verifiziert. Nur exakt übereinstimmende Pakete werden installiert — Supply-Chain-Angriffe werden blockiert.' },
        { icon: '⚡', heading: 'Hot-Reload', text: 'Nach Installation werden Plugins ohne Server-Restart geladen. Adapter stehen sofort allen Agenten zur Verfügung.' },
        { icon: '🧩', heading: 'Anwendung', text: 'Beispiele: LLM-Provider der nicht built-in ist, internes Firmen-API als Tool, Kunden-spezifischer Output-Formatter, Notion/Linear/Jira-Integration.' },
        { icon: '🏗', heading: 'Eigene bauen', text: 'Ein Plugin ist ein Git-Repo oder Tarball mit einer plugin.json. Du kannst eigene Plugins privat betreiben (eigene Registry-URL).' },
      ],
      tip: 'Tipp: Installiere nur Plugins aus Registries denen du vertraust. Ein Plugin läuft mit allen Server-Berechtigungen — wie npm-Pakete.',
    },
    en: {
      intro: 'Plugins extend OpenCognit with new LLM providers, tools, and integrations — without touching the core codebase. Browse the registry, install with one click, hot-reload without a server restart.',
      items: [
        { icon: '🔌', heading: 'What are plugins?', text: 'Adapter packages that register new capabilities: additional LLMs (e.g. Groq, Mistral API), domain-specific tools (GitHub, Slack, Jira), or output formatters.' },
        { icon: '📦', heading: 'Registry', text: 'The registry lists available plugins with version, tags, and source. The default registry is the official OpenCognit repo — but you can point to any URL.' },
        { icon: '🛡', heading: 'Security', text: 'Tarball plugins are verified via SHA-256 hash. Only exact matches are installed — supply-chain attacks are blocked.' },
        { icon: '⚡', heading: 'Hot reload', text: 'After install, plugins load without restarting the server. Adapters become immediately available to all agents.' },
        { icon: '🧩', heading: 'Use cases', text: 'Examples: an LLM provider not built-in, your internal company API as a tool, a customer-specific output formatter, Notion/Linear/Jira integration.' },
        { icon: '🏗', heading: 'Build your own', text: 'A plugin is a git repo or tarball with a plugin.json. You can run private plugins via your own registry URL.' },
      ],
      tip: 'Tip: Only install plugins from registries you trust. A plugin runs with full server permissions — like npm packages.',
    },
  },

  workers: {
    de: {
      intro: 'Worker-Nodes verteilen Agenten-Ausführung auf mehrere Maschinen. Der Haupt-Server koordiniert, die Worker führen aus — perfekt für Last-Verteilung, GPU-Boxen oder geografische Nähe zum Kunden.',
      items: [
        { icon: '🖥', heading: 'Was ist ein Worker?', text: 'Ein Prozess auf einer anderen Maschine der sich beim OpenCognit-Server registriert und Arbeit aus der Queue zieht. Pro Worker definierst du Capabilities (bash, claude-code, ollama...).' },
        { icon: '🔑', heading: 'Registration', text: 'Klicke "Register Worker", wähle Name und Capabilities — du bekommst einen Token einmalig angezeigt. Setze ihn auf der Worker-Maschine in die .env.' },
        { icon: '⚖️', heading: 'Capabilities-Matching', text: 'Nur Worker deren Capabilities zum Agenten-Typ passen bekommen die Arbeit. Ein Ollama-Task geht nur an Worker mit "ollama"-Fähigkeit.' },
        { icon: '🔄', heading: 'Atomic Claim', text: 'Worker wetteifern um Jobs per Compare-and-Swap. Kein Job wird doppelt ausgeführt — auch bei 50 Workern gleichzeitig.' },
        { icon: '💓', heading: 'Heartbeat', text: 'Jeder Worker pingt alle paar Sekunden. Bleibt ein Heartbeat 90s aus, wird er auf offline gesetzt und bekommt keine neue Arbeit.' },
        { icon: '🌍', heading: 'Anwendung', text: 'Hoher Durchsatz (parallele Ausführung), GPU-Worker für lokale LLMs, geografische Verteilung (EU-Worker für EU-Kunden), Kosten-Isolation pro Team.' },
      ],
      tip: 'Tipp: Der Haupt-Server arbeitet auch ohne externe Worker — die laufen eingebettet. Skaliere erst horizontal wenn du die CPU/GPU-Limits spürst.',
    },
    en: {
      intro: 'Worker nodes distribute agent execution across multiple machines. The main server coordinates, workers execute — perfect for load balancing, GPU boxes, or geographic proximity.',
      items: [
        { icon: '🖥', heading: 'What is a worker?', text: 'A process on another machine that registers with the OpenCognit server and pulls work from the queue. You define capabilities per worker (bash, claude-code, ollama...).' },
        { icon: '🔑', heading: 'Registration', text: 'Click "Register Worker", pick a name and capabilities — a token is shown once. Copy it into the worker machine\'s .env.' },
        { icon: '⚖️', heading: 'Capability matching', text: 'Only workers whose capabilities match the agent type receive the job. An Ollama task only goes to workers with the "ollama" capability.' },
        { icon: '🔄', heading: 'Atomic claim', text: 'Workers compete for jobs via compare-and-swap. No job runs twice — even with 50 workers in parallel.' },
        { icon: '💓', heading: 'Heartbeat', text: 'Every worker pings every few seconds. If no heartbeat for 90s, it\'s marked offline and receives no more work.' },
        { icon: '🌍', heading: 'Use cases', text: 'High throughput (parallel execution), GPU workers for local LLMs, geographic distribution (EU workers for EU customers), cost isolation per team.' },
      ],
      tip: 'Tip: The main server works fine without external workers — they run embedded. Scale horizontally only when you feel CPU/GPU limits.',
    },
  },

  focus: {
    de: {
      intro: 'Focus Mode fasst das Wichtigste zusammen: Was ist heute deine Priorität? Was blockiert das Team? Was haben Agenten zuletzt erledigt?',
      items: [
        { icon: '🎯', heading: 'Tages-Prioritäten', text: 'Wähle bis zu 3 Aufgaben als heutige Prioritäten. Diese werden dem Team als wichtigste Tasks kommuniziert.' },
        { icon: '🚧', heading: 'Blocker', text: 'Blockierte Tasks werden oben angezeigt. Klicke darauf um dem Agent direkt zu helfen.' },
        { icon: '✅', heading: 'Erledigte Tasks', text: 'Was deine Agenten heute bereits abgeschlossen haben — ein schneller Überblick über den Fortschritt.' },
        { icon: '🎙', heading: 'Standup', text: 'Generiert automatisch einen KI-Standup-Report mit Zusammenfassung aller Agenten-Aktivitäten.' },
      ],
      tip: 'Tipp: Nutze Focus Mode morgens als ersten Blick auf den Tag — 2 Minuten reichen um das Team zu überblicken.',
    },
    en: {
      intro: 'Focus Mode summarizes the most important things: What\'s your priority today? What\'s blocking the team? What have agents completed recently?',
      items: [
        { icon: '🎯', heading: 'Daily priorities', text: 'Choose up to 3 tasks as today\'s priorities. These are communicated to the team as the most important tasks.' },
        { icon: '🚧', heading: 'Blockers', text: 'Blocked tasks are shown at the top. Click them to directly help the agent.' },
        { icon: '✅', heading: 'Completed tasks', text: 'What your agents have already finished today — a quick overview of progress.' },
        { icon: '🎙', heading: 'Standup', text: 'Automatically generates an AI standup report summarizing all agent activities.' },
      ],
      tip: 'Tip: Use Focus Mode as your first look of the day — 2 minutes is enough to get an overview of the team.',
    },
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PageHelp({ id, lang }: { id: PageId; lang: string }) {
  const de = lang === 'de';
  const storageKey = `pagehelp_${id}`;
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    // Default open for first visit (null = never seen)
    return stored === null ? true : stored === '1';
  });

  const content = CONTENT[id]?.[de ? 'de' : 'en'];
  if (!content) return null;

  const toggle = (next: boolean) => {
    localStorage.setItem(storageKey, next ? '1' : '0');
    setOpen(next);
  };

  return (
    <div style={{ marginBottom: open ? '1.25rem' : '0.5rem' }}>
      {open ? (
        <div style={{
          background: 'rgba(35,205,202,0.03)',
          border: '1px solid rgba(35,205,202,0.12)',
          borderRadius: 16,
          overflow: 'hidden',
          animation: 'helpSlideIn 0.2s ease-out',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 12, padding: '14px 18px 12px',
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 1,
                background: 'rgba(35,205,202,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <HelpCircle size={14} style={{ color: '#23CDCB' }} />
              </div>
              <p style={{
                margin: 0, fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6,
                maxWidth: 680,
              }}>
                {content.intro}
              </p>
            </div>
            <button
              onClick={() => toggle(false)}
              title={de ? 'Schließen' : 'Close'}
              style={{
                flexShrink: 0, background: 'none', border: 'none',
                cursor: 'pointer', color: '#3f3f46', padding: 4, display: 'flex',
                borderRadius: 6,
              }}
            >
              <ChevronUp size={14} />
            </button>
          </div>

          {/* Items grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1,
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            {content.items.map((item, i) => (
              <div key={i} style={{
                padding: '11px 16px',
                background: 'rgba(255,255,255,0.01)',
                borderRight: '1px solid rgba(255,255,255,0.03)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{item.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#71717a', letterSpacing: '0.02em' }}>
                    {item.heading}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 11.5, color: '#52525b', lineHeight: 1.55 }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          {/* Tip */}
          {content.tip && (
            <div style={{
              padding: '9px 18px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>💡</span>
              <span style={{ fontSize: 11.5, color: '#3f3f46', lineHeight: 1.5 }}>{content.tip}</span>
            </div>
          )}
        </div>
      ) : (
        /* Collapsed: just a tiny "?" button */
        <button
          onClick={() => toggle(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '4px 10px',
            cursor: 'pointer', color: '#3f3f46',
            fontSize: 11, fontWeight: 600,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(35,205,202,0.3)';
            (e.currentTarget as HTMLElement).style.color = '#23CDCB';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
            (e.currentTarget as HTMLElement).style.color = '#3f3f46';
          }}
        >
          <HelpCircle size={12} />
          {de ? 'Wie funktioniert das?' : 'How does this work?'}
          <ChevronDown size={11} />
        </button>
      )}

      <style>{`
        @keyframes helpSlideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
