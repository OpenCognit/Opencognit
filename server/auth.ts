import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client.js";
import * as schema from "./db/schema.js";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || "opencognit-dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3201",
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  trustedOrigins: [
    "http://localhost:3200",
    "http://localhost:3201",
  ],
});
