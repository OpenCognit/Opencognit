// Channel Plugin System — Types
// Erweiterbare Abstraktion für Messaging-Channels
//
// Jeder Channel (Telegram, WhatsApp, Discord, etc.) implementiert dieses Interface.
// Neue Channels werden über das Plugin-System registriert.

export interface InboundMessage {
  senderId: string;
  senderName?: string;
  channel: string;
  text: string;
  timestamp: string;
  // Optionale Medien (Bilder, Audio, Dateien)
  media?: Array<{
    type: 'image' | 'audio' | 'video' | 'file';
    url?: string;
    base64?: string;
    mimeType?: string;
    filename?: string;
  }>;
  // Plattform-spezifische Metadaten
  raw?: any;
}

export interface OutboundMessage {
  channel: string;
  recipientId?: string;
  text: string;
  // Optionales Markup (Markdown, HTML — wird je nach Channel konvertiert)
  format?: 'text' | 'markdown' | 'html';
  media?: Array<{
    type: 'image' | 'audio' | 'video' | 'file';
    url?: string;
    base64?: string;
    mimeType?: string;
    filename?: string;
  }>;
}

export interface ChannelStatus {
  connected: boolean;
  lastActivity?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Channel Plugin Interface — jeder Messaging-Channel implementiert dies.
 */
export interface ChannelPlugin {
  /** Eindeutiger Channel-Name (z.B. "telegram", "discord") */
  id: string;

  /** Anzeigename für die UI */
  name: string;

  /** Beschreibung */
  description: string;

  /** Icon (Emoji oder URL) */
  icon: string;

  /**
   * Initialisiert den Channel mit der Konfiguration.
   * Wird beim Server-Start aufgerufen.
   */
  initialize(config: ChannelConfig): Promise<void>;

  /**
   * Sendet eine Nachricht über diesen Channel.
   */
  send(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }>;

  /**
   * Gibt den aktuellen Status zurück.
   */
  status(): ChannelStatus;

  /**
   * Registriert Express-Routes für Webhooks (falls nötig).
   * Wird aufgerufen mit dem Express Router.
   */
  registerWebhooks?(router: any): void;

  /**
   * Cleanup beim Shutdown.
   */
  shutdown?(): Promise<void>;
}

export interface ChannelConfig {
  /** API-Token oder Secret */
  token?: string;
  /** Webhook-Secret für eingehende Nachrichten */
  webhookSecret?: string;
  /** Zusätzliche Konfiguration */
  extra?: Record<string, any>;
}

/**
 * Callback der aufgerufen wird wenn eine Nachricht eingeht.
 */
export type InboundHandler = (
  unternehmenId: string,
  message: InboundMessage
) => Promise<void>;
