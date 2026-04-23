#!/bin/bash
set -e

echo "Setting up Mission Control..."

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  corepack enable && corepack prepare pnpm@latest --activate
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Set up environment
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

# Generate an MC_INGEST_TOKENS value if the user doesn't already have one.
# Any existing non-empty MC_INGEST_TOKENS= line is left untouched so that
# re-running setup never invalidates live reporters.
if ! grep -Eq '^[[:space:]]*MC_INGEST_TOKENS=.+' .env; then
  if command -v openssl >/dev/null 2>&1; then
    token="$(openssl rand -hex 32)"
  else
    token="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  fi
  if grep -Eq '^[[:space:]]*#?[[:space:]]*MC_INGEST_TOKENS=' .env; then
    # Replace commented-out or empty line in place (portable sed)
    tmp="$(mktemp)"
    sed -E "s|^[[:space:]]*#?[[:space:]]*MC_INGEST_TOKENS=.*|MC_INGEST_TOKENS=$token|" .env > "$tmp" && mv "$tmp" .env
  else
    printf '\n# Auto-generated on first install by scripts/setup.sh\nMC_INGEST_TOKENS=%s\n' "$token" >> .env
  fi
  echo "Generated MC_INGEST_TOKENS and wrote it to .env"
fi

echo ""
echo "Setup complete! Run: pnpm dev"
