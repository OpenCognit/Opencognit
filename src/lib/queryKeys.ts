// Query Keys für TanStack Query — zentrale Definition verhindert Cache-Typos

export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    session: ['auth', 'session'] as const,
  },
  unternehmen: {
    all: ['unternehmen'] as const,
    liste: ['unternehmen', 'liste'] as const,
    details: (id: string) => ['unternehmen', 'details', id] as const,
  },
  experten: {
    all: ['experten'] as const,
    liste: (unternehmenId: string) => ['experten', 'liste', unternehmenId] as const,
    details: (id: string) => ['experten', 'details', id] as const,
    aktivitaet: (id: string) => ['experten', 'aktivitaet', id] as const,
  },
  aufgaben: {
    all: ['aufgaben'] as const,
    liste: (unternehmenId: string) => ['aufgaben', 'liste', unternehmenId] as const,
    details: (id: string) => ['aufgaben', 'details', id] as const,
    kommentare: (id: string) => ['aufgaben', 'kommentare', id] as const,
  },
  genehmigungen: {
    all: ['genehmigungen'] as const,
    liste: (unternehmenId: string) => ['genehmigungen', 'liste', unternehmenId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    laden: (unternehmenId: string) => ['dashboard', 'laden', unternehmenId] as const,
  },
  kosten: {
    all: ['kosten'] as const,
    zusammenfassung: (unternehmenId: string) => ['kosten', 'zusammenfassung', unternehmenId] as const,
  },
  aktivitaet: {
    all: ['aktivitaet'] as const,
    liste: (unternehmenId: string) => ['aktivitaet', 'liste', unternehmenId] as const,
  },
  system: {
    all: ['system'] as const,
    status: ['system', 'status'] as const,
    health: ['system', 'health'] as const,
  },
};
