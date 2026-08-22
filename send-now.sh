#!/bin/bash

# Cleanup any existing Chrome/Puppeteer processes
pkill -f "chrome|puppeteer" 2>/dev/null || true

# Wait a moment for processes to terminate
sleep 1

# Run the send-now script
npm run send-now
