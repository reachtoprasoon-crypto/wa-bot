FROM node:18-bullseye

# Install system dependencies required by Puppeteer/Chrome
RUN apt-get update && apt-get install -y \
    libatk-1.0-0 \
    libatk-bridge2.0-0 \
    libgbm-dev \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxss1 \
    libxdamage1 \
    libxrandr2 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "start"]
