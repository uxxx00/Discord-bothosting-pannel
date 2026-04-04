# Use a Node.js base image
FROM node:20

# Install Python and Pip (for your Python bots)
RUN apt-get update && apt-get install -y python3 python3-pip

# Set up work directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy all project files
COPY . .

# Set environment variables (Standard for Hugging Face)
ENV PORT=7860

# Expose the port HF Spaces uses
EXPOSE 7860

# Start the server
CMD ["node", "server.js"]
