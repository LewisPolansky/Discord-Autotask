FROM node:18-alpine

WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --omit=dev

COPY . .

EXPOSE 3000 # Assuming your bot might eventually have an HTTP endpoint, though not strictly necessary for a Discord bot.

CMD [ "node", "index.js" ] 