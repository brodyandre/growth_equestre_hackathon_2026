FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
ENV NODE_ENV=production
EXPOSE 3100
CMD ["npm","start"]
