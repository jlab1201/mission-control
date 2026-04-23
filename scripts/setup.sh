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

echo ""
echo "Setup complete! Run: pnpm dev"
