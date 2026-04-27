// BetterAuth client for OpenCognit
import { createAuthClient } from 'better-auth/react';

// Use relative baseURL so requests go through Vite dev proxy (/api → localhost:3201)
// In production, the API is served from the same origin or via reverse proxy
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || '',
});
