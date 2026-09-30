FROM node:22-slim

# Install build dependencies required for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]