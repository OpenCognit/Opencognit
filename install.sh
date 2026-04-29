#!/bin/bash
# OpenCognit Installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/OpenCognit/opencognit/main/install.sh)

set -e

GOLD="\033[38;5;179m"
GOLD2="\033[38;5;137m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
BOLD="\033[1m"
RESET="\033[0m"

banner() {
  echo -e "${GOLD}${BOLD}"
  echo -e " ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗██╗████████╗"
  echo -e "██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔════╝ ████╗  ██║██║╚══██╔══╝"
  echo -e "██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║██║  ███╗██╔██╗ ██║██║   ██║   "
  echo -e "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║   ██║██║╚██╗██║██║   ██║   "
  echo -e "╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║██║   ██║   "
  echo -e " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝  "
  echo -e ""
  echo -e "   Zero Human Company OS"
  echo -e "${RESET}"
}

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; exit 1; }
info() { echo -e "  \033[2m$1${RESET}"; }
step() { echo -e "\n${GOLD}${BOLD}[$1/$2]${RESET} ${BOLD}$3${RESET}"; }

# Find a free TCP port starting from $1
find_free_port() {
  local port=$1
  while nc -z localhost "$port" 2>/dev/null; do
    port=$((port + 1))
  done
  echo "$port"
}

banner

# ── Prerequisites ─────────────────────────────────────────────────────────────
step 1 5 "Checking prerequisites…"

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it from https://nodejs.org (v20+ required)"
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ required. You have $(node -v). Get it at https://nodejs.org"
fi
ok "Node.js $(node -v)"

if ! command -v git &>/dev/null; then
  fail "Git not found. Install it from https://git-scm.com"
fi
ok "Git $(git --version | awk '{print $3}')"

# ── Project name ──────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Installation directory${RESET} \033[2m(opencognit)\033[0m"
read -r -p "  › " PROJECT_NAME </dev/tty
PROJECT_NAME="${PROJECT_NAME:-opencognit}"

if [ -d "$PROJECT_NAME" ]; then
  fail "Directory '$PROJECT_NAME' already exists. Choose a different name."
fi

# ── API Key (optional) ────────────────────────────────────────────────────────
echo ""
echo -e "  \033[2mOptional: add an LLM API key now (you can also do this later in Settings)\033[0m"
echo -e "  ${BOLD}Anthropic / OpenRouter API key${RESET} \033[2m(Enter to skip)\033[0m"
read -r -p "  › " API_KEY </dev/tty

# ── Clone ─────────────────────────────────────────────────────────────────────
step 2 5 "Cloning OpenCognit…"
REPO="https://github.com/OpenCognit/opencognit.git"
git clone --depth=1 "$REPO" "$PROJECT_NAME" || fail "Could not clone $REPO — check your internet connection."
ok "Repository cloned → $PROJECT_NAME"

cd "$PROJECT_NAME"

# ── Install dependencies ──────────────────────────────────────────────────────
step 3 5 "Installing dependencies…"
npm install --prefer-offline --silent || fail "npm install failed. Try running it manually."
ok "Dependencies installed"

# ── Secrets + Port + DB ───────────────────────────────────────────────────────
step 4 5 "Generating secrets and initializing database…"

mkdir -p data

JWT_SECRET=$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")

# Auto-detect a free port (production uses a single port for API + UI)
PORT=$(find_free_port 3201)

cat > .env <<EOF
PORT=${PORT}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
# Add your LLM API keys here (or configure them later in Settings):
# ANTHROPIC_API_KEY=sk-ant-...
# OPENROUTER_API_KEY=sk-or-...
# OPENAI_API_KEY=sk-...
# OLLAMA_BASE_URL=http://localhost:11434

# For remote/phone access set your server IP or domain:
# APP_URL=http://192.168.1.100:${PORT}
EOF

# Inject API key if provided
if [ -n "$API_KEY" ]; then
  if [[ "$API_KEY" == sk-ant-* ]]; then
    sed -i "s|# ANTHROPIC_API_KEY=sk-ant-\.\.\.|ANTHROPIC_API_KEY=${API_KEY}|" .env
  elif [[ "$API_KEY" == sk-or-* ]]; then
    sed -i "s|# OPENROUTER_API_KEY=sk-or-\.\.\.|OPENROUTER_API_KEY=${API_KEY}|" .env
  fi
  ok "API key saved to .env"
fi

ok ".env generated (port: ${PORT})"

npm run db:migrate --silent 2>/dev/null && ok "Database initialized" || warn "DB migration will run on first start."

# ── Build ─────────────────────────────────────────────────────────────────────
step 5 5 "Building frontend…"
npm run build --silent && ok "Frontend built" || fail "Build failed. Check the output above."

# ── Global command ────────────────────────────────────────────────────────────
INSTALL_DIR="$(pwd)"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/opencognit" <<SCRIPT
#!/bin/bash
INSTALL_DIR="${INSTALL_DIR}"
PORT="${PORT}"
GOLD="\033[38;5;179m"; BOLD="\033[1m"; RESET="\033[0m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"

case "\$1" in
  update)
    echo -e "\${GOLD}\${BOLD}Updating OpenCognit...\${RESET}"
    cd "\$INSTALL_DIR"
    git pull || { echo -e "  \${RED}✗\${RESET} git pull failed"; exit 1; }
    npm install --silent || { echo -e "  \${RED}✗\${RESET} npm install failed"; exit 1; }
    npm run build --silent || { echo -e "  \${RED}✗\${RESET} build failed"; exit 1; }
    echo -e "  \${GREEN}✓\${RESET} Updated. Run 'opencognit' to start."
    ;;
  uninstall)
    echo -e "\${YELLOW}This will remove the opencognit command.\${RESET}"
    echo -e "  Installation: \$INSTALL_DIR"
    echo ""
    read -r -p "  Delete installation directory too? [y/N] " DEL_DIR
    rm -f "\$HOME/.local/bin/opencognit"
    echo -e "  \${GREEN}✓\${RESET} Command removed."
    if [[ "\$DEL_DIR" =~ ^[Yy]\$ ]]; then
      rm -rf "\$INSTALL_DIR"
      echo -e "  \${GREEN}✓\${RESET} Installation deleted."
    else
      echo -e "  \${YELLOW}→\${RESET} Installation kept at: \$INSTALL_DIR"
    fi
    echo -e "\n  Goodbye 👋"
    ;;
  help|--help|-h)
    echo -e "\n  \${GOLD}\${BOLD}opencognit\${RESET} — Zero Human Company OS\n"
    echo -e "  \${BOLD}Usage:\${RESET}"
    echo -e "    \${GOLD}opencognit\${RESET}            Start the server"
    echo -e "    \${GOLD}opencognit update\${RESET}     Pull latest version & rebuild"
    echo -e "    \${GOLD}opencognit uninstall\${RESET}  Remove OpenCognit"
    echo -e "    \${GOLD}opencognit help\${RESET}       Show this help"
    echo -e "\n  \${BOLD}Install dir:\${RESET} \$INSTALL_DIR"
    echo -e "  \${BOLD}URL:\${RESET}          http://localhost:\${PORT}"
    echo -e "  \${BOLD}Docs:\${RESET}         https://github.com/OpenCognit/opencognit\n"
    ;;
  *)
    echo -e "\n  \${GOLD}\${BOLD}Starting OpenCognit...\${RESET}"
    echo -e "  \033[2mOpen http://localhost:\${PORT} in your browser\${RESET}\n"
    cd "\$INSTALL_DIR" && npm start
    ;;
esac
SCRIPT
chmod +x "$BIN_DIR/opencognit"

# Add ~/.local/bin to PATH if not already there
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"; fi

if [ -n "$SHELL_RC" ] && ! grep -q '\.local/bin' "$SHELL_RC" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
  ok "PATH updated in $SHELL_RC"
fi
export PATH="$HOME/.local/bin:$PATH"
ok "Global command 'opencognit' installed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ OpenCognit installed successfully.${RESET}"
echo ""
echo -e "  ${BOLD}Start with:${RESET}"
echo ""
echo -e "    ${GOLD}${BOLD}opencognit${RESET}"
echo ""
echo -e "  Then open ${GOLD}${BOLD}http://localhost:${PORT}${RESET} and create your account."
echo ""
echo -e "  \033[2mGitHub: https://github.com/OpenCognit/opencognit${RESET}"
echo ""
