FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./server.js
COPY public ./public
COPY scripts ./scripts
COPY data ./data
RUN mkdir -p /app/data/uploads/avatars /app/certs
EXPOSE 3000
CMD ["npm", "start"]
