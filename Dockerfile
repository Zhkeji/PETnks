FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p uploads backups
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "server.js"]
