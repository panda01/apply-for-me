#!/usr/bin/env bash
set -e

# Start both dev servers in the background
npx concurrently \
  --names "server,client" \
  "npx tsx watch server/src/index.ts" \
  "npx vite --config client/vite.config.ts" &

CONCURRENTLY_PID=$!

# Wait for servers to start
sleep 5

# Check if the backend is alive
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "Backend is running"
else
  echo "Backend failed to start"
  kill $CONCURRENTLY_PID 2>/dev/null || true
  wait $CONCURRENTLY_PID 2>/dev/null || true
  echo "Dev server exited"
  exit 1
fi

# Check if the frontend is alive
if curl -s http://localhost:5173 > /dev/null 2>&1; then
  echo "Frontend is running"
else
  echo "Frontend failed to start"
  kill $CONCURRENTLY_PID 2>/dev/null || true
  wait $CONCURRENTLY_PID 2>/dev/null || true
  echo "Dev server exited"
  exit 1
fi

echo "All servers verified successfully"

# Kill the servers
kill $CONCURRENTLY_PID 2>/dev/null || true
wait $CONCURRENTLY_PID 2>/dev/null || true

echo "Dev server exited"
