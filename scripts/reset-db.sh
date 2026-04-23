#!/bin/bash
set -e
echo "Resetting database..."
rm -f dev.db dev.db-journal
pnpm prisma migrate deploy
echo "Database reset complete."
