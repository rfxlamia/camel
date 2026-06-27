#!/bin/sh
set -e

echo "Running DB migrations..."
node /app/server/dist/db/migrate.js

echo "Starting server..."
exec node /app/server/dist/index.js
