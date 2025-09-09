#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
GIT_BRANCH="main"              # Branch to pull from
COMPOSE_FILE="docker-compose.yml"  # Compose file
SERVICE_NAME="portfolio-app"   # Service name in Compose

# --- Helper Functions ---
print_message() {
    echo "===================================================="
    echo "$1"
    echo "===================================================="
}

# --- Initial Setup: .env file ---
# Check if .env file exists. If not, create it from env.example and generate a secret key.
if [ ! -f .env ]; then
    print_message "'.env' file not found. Creating a new one for you..."
    
    # Generate a secure secret key and create the .env file
    python3 -c "import secrets; print(f'SECRET_KEY={secrets.token_hex(32)}')" > .env
    
    # Add other default configurations (you can add more here from env.example if needed)
    echo "FLASK_ENV=production" >> .env
    echo "APP_DATA_DIR=instance" >> .env
    echo "DB_BACKUP_DIR=instance/backups" >> .env
    echo "MAX_BACKUP_FILES=10" >> .env
    echo "BACKUP_INTERVAL_HOURS=6" >> .env
    
    echo "A new .env file has been created with a secure SECRET_KEY."
    echo "You can customize it later if needed."
fi

# --- Pre-flight Check: Docker ---
# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# --- Deployment Steps ---

# 1. Pull latest changes from Git
print_message "Pulling latest changes from Git..."
git checkout "$GIT_BRANCH" || { echo "Error: Failed to checkout branch."; exit 1; }
git pull origin "$GIT_BRANCH" || { echo "Error: Git pull failed."; exit 1; }

# 1.5 Ensure instance directory exists with correct host permissions
print_message "Ensuring instance directory exists..."
mkdir -p ./instance
chown -R $(whoami):$(whoami) ./instance
chmod -R 755 ./instance

# 2. Build the Docker image (caching handles no-op if unchanged)
print_message "Building Docker image..."
docker compose -f "$COMPOSE_FILE" build --pull

# 3. Restart the service (force-recreate ensures clean start)
print_message "Restarting Docker container..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$SERVICE_NAME"

# 4. Clean up old images
print_message "Cleaning up old Docker images..."
docker image prune -f

print_message "Deployment successful! App is running."
