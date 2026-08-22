#!/bin/bash

# Kill any existing Chrome/Puppeteer processes
pkill -f "chrome|puppeteer" || true

# Wait a moment for processes to clean up
sleep 1

# Run the actual send-now script
node send-now.js
