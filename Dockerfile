FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Set executable permissions for the entry point
RUN chmod +x build/index.js

# Run the application
CMD ["npm", "start"]
