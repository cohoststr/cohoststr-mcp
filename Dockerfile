FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

ENV GUESTY_CLIENT_ID=""
ENV GUESTY_CLIENT_SECRET=""

EXPOSE 3001 3002

CMD ["node", "src/server.js"]
