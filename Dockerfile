# Use Node.js 22 LTS alpine image
FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Run the application
CMD ["node", "server.js"]
