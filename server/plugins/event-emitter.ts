// Event Emitter - Ermöglicht Kommunikation zwischen Plugins

import { EventEmitter } from './types.js';

/**
 * Einfacher Event Emitter für die Plugin-Kommunikation
 */
export class SimpleEventEmitter implements EventEmitter {
  // Handler-Map: Event-Name -> Array von Handlern
  private handlers: Map<string, Array<(payload?: any) => void | Promise<void>>> = new Map();

  // Einmal-Handler-Map: Event-Name -> Array von Handlern
  private onceHandlers: Map<string, Array<(payload?: any) => void | Promise<void>>> = new Map();

  /**
   * Event auslösen und alle registrierten Handler benachrichtigen
   */
  async emit(eventName: string, payload?: any): Promise<void> {
    // Reguläre Handler aufrufen
    const handlers = this.handlers.get(eventName) || [];
    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`Error in event handler for ${eventName}:`, error);
      }
    }

    // Einmal-Handler aufrufen und entfernen
    const onceHandlers = this.onceHandlers.get(eventName) || [];
    this.onceHandlers.set(eventName, []);

    for (const handler of onceHandlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`Error in once event handler for ${eventName}:`, error);
      }
    }
  }

  /**
   * Event-Handler registrieren
   */
  on(eventName: string, handler: (payload?: any) => void | Promise<void>): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName)?.push(handler);
  }

  /**
   * Event-Handler entfernen
   */
  off(eventName: string, handler: (payload?: any) => void | Promise<void>): void {
    if (!this.handlers.has(eventName)) {
      return;
    }

    const handlers = this.handlers.get(eventName) || [];
    const index = handlers.indexOf(handler);

    if (index !== -1) {
      handlers.splice(index, 1);
      this.handlers.set(eventName, handlers);
    }
  }

  /**
   * Einmal-Event-Handler registrieren
   */
  once(eventName: string, handler: (payload?: any) => void | Promise<void>): void {
    if (!this.onceHandlers.has(eventName)) {
      this.onceHandlers.set(eventName, []);
    }
    this.onceHandlers.get(eventName)?.push(handler);
  }

  /**
   * Alle Handler für ein Event entfernen
   */
  clearEvent(eventName: string): void {
    this.handlers.delete(eventName);
    this.onceHandlers.delete(eventName);
  }

  /**
   * Alle Handler entfernen
   */
  clearAll(): void {
    this.handlers.clear();
    this.onceHandlers.clear();
  }
}

// Singleton-Instanz für die Anwendung
export const eventEmitter = new SimpleEventEmitter();