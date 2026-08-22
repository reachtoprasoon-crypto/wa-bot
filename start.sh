#!/bin/bash
# Start the WA bot with logging. Kills any existing instance first.
cd "$(dirname "$0")"

LOG_FILE="bot.log"
PID_FILE="bot.pid"

# Kill previous instance if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping previous bot instance (PID $OLD_PID)..."
    kill "$OLD_PID"
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

# Kill any leftover node index.js processes in this directory
pkill -f "node index.js" 2>/dev/null
sleep 1

echo "[$(date)] Starting WA Bot..." | tee -a "$LOG_FILE"
node index.js >> "$LOG_FILE" 2>&1 &
BOT_PID=$!
echo "$BOT_PID" > "$PID_FILE"
echo "[$(date)] Bot started with PID $BOT_PID. Logs: $LOG_FILE"
echo "Run: tail -f $LOG_FILE"
