FROM node:20

# Install build dependencies required to rebuild sqlite3 locally
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# Rebuild native modules to match container's GLIBC version
RUN npm rebuild sqlite3 --build-from-source

COPY . .
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]