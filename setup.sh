#!/bin/bash
# ── OpenCognit Quick Setup ────────────────────────────────────────────────────
# Runs on: Linux, macOS
# Requirements: Node.js ≥ 20, npm ≥ 10
# Usage: bash setup.sh

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ██████╗ ██████╗ ███████╗███╗   ██╗${NC}"
echo -e "${CYAN} ██╔═══██╗██╔══██╗██╔════╝████╗  ██║${NC}"
echo -e "${CYAN} ██║   ██║██████╔╝█████╗  ██╔██╗ ██║${NC}"
echo -e "${CYAN} ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║${NC}"
echo -e "${CYAN} ╚██████╔╝██║     ███████╗██║ ╚████║${NC}"
echo -e "${CYAN}  ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝${NC}"
echo ""
echo -e "${CYAN}  C O G N I T${NC}"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Install Node.js ≥ 20 from https://nodejs.org${NC}"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}✗ Node.js ≥ 20 required (found v$NODE_VERSION)${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# ── Install dependencies ───────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}→ Installing dependencies...${NC}"
npm install --include=dev

# ── Generate .env if missing ───────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo -e "${CYAN}→ Creating .env file...${NC}"
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << EOF
PORT=3201
NODE_ENV=development
ENCRYPTION_KEY=${ENCRYPTION_KEY}
JWT_SECRET=${JWT_SECRET}
EOF
  echo -e "${GREEN}✓ .env created${NC}"
else
  echo -e "${GREEN}✓ .env already exists${NC}"
fi

# ── Database setup ─────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}→ Setting up database...${NC}"
npm run db:migrate
npm run db:seed
echo -e "${GREEN}✓ Database ready${NC}"

# ── Build frontend ─────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}→ Building frontend...${NC}"
npm run build
echo -e "${GREEN}✓ Frontend built${NC}"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  OpenCognit is ready!${NC}"
echo ""
echo -e "  Start:        ${CYAN}npm start${NC}"
echo -e "  Open:         ${CYAN}http://localhost:3201${NC}"
echo ""
echo -e "  Admin login:  ${YELLOW}admin@opencognit.com${NC}"
echo -e "  Password:     see ${YELLOW}data/initial-credentials.txt${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
