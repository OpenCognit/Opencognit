# ── OpenCognit — Dockerfile ───────────────────────────────────────────────────
# Single-container build: compiles frontend + runs backend in one image.
# For production use, mount ./data as a volume to persist the database.

FROM node:20-alpine

# native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies (includes devDeps for tsx + build tools)
COPY package*.json ./
RUN npm install --include=dev

# Copy source
COPY . .

# Build frontend (Vite → dist/)
RUN npm run build

# Ensure data directory exists (will be volume-mounted in production)
RUN mkdir -p data

EXPOSE 3201

# On container start: run DB migrations, then launch server
CMD ["sh", "-c", "npm run db:migrate && node_modules/.bin/tsx server/index.ts"]
