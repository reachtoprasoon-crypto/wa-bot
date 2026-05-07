# wa-bot

This project posts the next day's duty roster to a WhatsApp group at a scheduled time using `whatsapp-web.js`.

## Requirements
- Node.js (16+) OR Docker

## Setup

### Option 1: Docker (Recommended)

Docker handles all system dependencies automatically:

```bash
# Build and start the bot
docker-compose up --build

# To run just send-now command
docker-compose run wa-bot npm run send-now
```

### Option 2: Local Installation

1. Install system dependencies (required for Puppeteer/Chrome):

```bash
sudo apt update && sudo apt install -y \
  libatk-1.0-0 libatk-bridge2.0-0 libgbm-dev libgbm1 libgtk-3-0 \
  libnss3 libxss1 libxdamage1 libxrandr2 libxkbcommon0 \
  libpango-1.0-0 libpangocairo-1.0-0 fonts-dejavu-core
```

2. Install dependencies:

```bash
npm install
```

3. Ensure `duty.csv` is present in the same directory (it already exists).

4. Start the bot and scan the QR from the account that is a member of the WhatsApp group:

```bash
npm start
```

When the `qr` event logs a QR string, scan it with WhatsApp (the phone/account used must be in the target group). The session is persisted in `.wwebjs_auth`.

## Scheduling
- By default the bot sends at `18:00` local time. Change this by setting environment variable `SEND_TIME` (format `HH:MM`) or in `.env` file.
- The target group name is set by `GROUP_NAME` env var (default `VSEC AVADH OFFICIAL`).

## Configuration Interface

The bot includes a web-based configuration interface to easily set the message format and send time:

1. Start the bot: `npm start`
2. Open your browser to `http://localhost:3000` (or the port specified in `PORT` env var)
3. Configure the send time, group name, and message format
4. Settings are saved to `config.json`

### Message Format

The message format supports placeholders:
- `{{duties}}` - Replaced with the formatted duty list
- `{{time}}` - Replaced with the current time when sending

Example format:
```
📋 *Tomorrow's Duty Roster* 📋

{{duties}}

---
⏰ Sent at {{time}}
```

### Copy Environment Template

```bash
cp .env.example .env
```

Then edit `.env` with your settings.

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow that deploys the static `index.html` page to GitHub Pages automatically on every push to `main`.

- Workflow file: `.github/workflows/deploy-pages.yml`
- The page is built from the repository root and published by GitHub Pages.

## Quick Commands

Send immediately (after client ready):

```bash
npm run send-now
```

Or with Docker:

```bash
docker-compose run wa-bot npm run send-now
```

## Notes
- The bot uses WhatsApp Web and requires scanning a QR using an account that is a member of the group.
- Official WhatsApp Business API may not allow posting to groups; this browser-driven approach works when the account is a member.
- WhatsApp may block or rate-limit automated messages. Use responsibly.
- Session data is stored in `.wwebjs_auth/` directory and persists between restarts.