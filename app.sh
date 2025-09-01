#!/bin/bash

# Portfolio Rebalancer - Unified App Management Script
# One command to handle everything automatically

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="portfolio_rebalancer"
CONTAINER_NAME="portfolio_rebalancer"
PORT="8065"
DATA_DIR="app/database"
BACKUP_DIR="app/database/backups"

# Function to print colored output
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }
log_analyze() { echo -e "${CYAN}🔍 $1${NC}"; }

# Detect docker compose command
detect_docker_compose() {
    if docker compose version &> /dev/null; then
        echo "docker compose"
    elif command -v docker-compose &> /dev/null; then
        echo "docker-compose"
    else
        log_error "Docker Compose is not installed. Please install Docker first."
        exit 1
    fi
}

# Show help
show_help() {
    echo -e "${BLUE}📋 Portfolio Rebalancer - App Manager${NC}"
    echo "======================================"
    echo
    echo "Usage:"
    echo "  ./app.sh                  Auto-manage app (always rebuild for latest changes)"
    echo "  ./app.sh --status         Show current status"
    echo "  ./app.sh --force-rebuild  Force full rebuild from scratch"
    echo "  ./app.sh --help           Show this help"
    echo
    echo "Examples:"
    echo "  ./app.sh                  # Always rebuild to ensure latest code"
    echo "  ./app.sh --status         # Check if app is running"
    echo "  ./app.sh --force-rebuild  # Force complete rebuild"
    echo
    echo "The script behavior:"
    echo "  • Always rebuilds containers to ensure latest code"
    echo "  • First time setup       → Full deployment"
    echo "  • Any changes detected   → Full rebuild" 
    echo "  • Docker changes         → Rebuild from scratch"
    echo "  • Broken containers      → Fix/rebuild"
}

# Show status
show_status() {
    echo -e "${BLUE}🏥 Portfolio Rebalancer Status${NC}"
    echo "================================"
    echo
    
    # Check if container exists and is running
    if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "$CONTAINER_NAME"; then
        log_success "Container is running"
        
        # Check health endpoint
        if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
            log_success "Health endpoint responding"
            
            # Get actual health response
            HEALTH_RESPONSE=$(curl -s http://localhost:$PORT/health 2>/dev/null || echo "Could not fetch health data")
            echo "📊 Health Response: $HEALTH_RESPONSE"
        else
            log_error "Health endpoint not responding"
            log_info "Check logs with: $(detect_docker_compose) logs $CONTAINER_NAME"
        fi
        
        # Check autoheal if present
        if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "portfolio_autoheal"; then
            log_success "Autoheal container is running"
        else
            log_warning "Autoheal container not running"
        fi
        
    else
        log_error "Container is not running"
        log_info "Run './app.sh' to start the application"
    fi
    
    echo
    echo "🔧 Quick Commands:"
    echo "  - Logs: $(detect_docker_compose) logs -f $CONTAINER_NAME"
    echo "  - Restart: $(detect_docker_compose) restart $CONTAINER_NAME" 
    echo "  - Make it work: ./app.sh"
}

# Check if file has changed since last build
file_changed_since_build() {
    local file="$1"
    local build_marker=".last_build_time"
    
    if [[ ! -f "$build_marker" ]]; then
        return 0  # No build marker = first time
    fi
    
    if [[ "$file" -nt "$build_marker" ]]; then
        return 0  # File is newer than last build
    fi
    
    return 1  # File hasn't changed
}

# Check if rebuild is needed (vs just update)
needs_rebuild() {
    # First time (no containers)
    if ! docker ps -a --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
        log_analyze "First time setup detected"
        return 0
    fi
    
    # Check if Docker-related files changed (only core Docker files, not dependencies)
    local docker_files=("Dockerfile" "docker-compose.yml" "app/database/schema_safe.sql")
    for file in "${docker_files[@]}"; do
        if [[ -f "$file" ]] && file_changed_since_build "$file"; then
            log_analyze "Docker file '$file' changed - rebuild needed"
            return 0
        fi
    done
    
    # Check if container is completely broken
    if docker ps -a --format "table {{.Names}}\t{{.Status}}" | grep "$CONTAINER_NAME" | grep -q "Exited\|Dead"; then
        log_analyze "Container is broken - rebuild needed"
        return 0
    fi
    
    # Check if container won't start
    if ! docker ps --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
        if docker ps -a --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
            log_analyze "Container exists but not running - trying to start first"
            DOCKER_COMPOSE_CMD=$(detect_docker_compose)
            if ! $DOCKER_COMPOSE_CMD start $CONTAINER_NAME &>/dev/null; then
                log_analyze "Container won't start - rebuild needed"
                return 0
            fi
        fi
    fi
    
    return 1  # No rebuild needed
}

# Check if update is needed
needs_update() {
    # Check if code files changed (including requirements.txt for quick dependency updates)
    local code_files=("app/" "templates/" "static/" "config.py" ".env" "run.py" "requirements.txt")
    for file in "${code_files[@]}"; do
        if [[ -e "$file" ]] && file_changed_since_build "$file"; then
            log_analyze "Code file '$file' changed - update needed"
            return 0
        fi
    done
    
    return 1  # No update needed
}

# Check if app is healthy
is_app_healthy() {
    # Check if container is running
    if ! docker ps --format "table {{.Names}}" | grep -q "$CONTAINER_NAME"; then
        return 1
    fi
    
    # Check health endpoint
    if ! curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        return 1
    fi
    
    return 0
}

# Perform full rebuild from scratch
do_rebuild() {
    log_info "🔨 Rebuilding from scratch..."
    log_warning "This will take ~3 minutes"
    
    DOCKER_COMPOSE_CMD=$(detect_docker_compose)
    
    # Stop and remove existing containers
    $DOCKER_COMPOSE_CMD down 2>/dev/null || true
    
    # Create necessary directories
    log_info "Setting up directories..."
    sudo mkdir -p "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || {
        mkdir -p "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
    }
    
    # Set permissions
    sudo chown -R $(id -u):$(id -g) "$DATA_DIR" 2>/dev/null || {
        chown -R $(id -u):$(id -g) "$DATA_DIR" 2>/dev/null || true
    }
    sudo chmod -R 755 "$DATA_DIR" 2>/dev/null || {
        chmod -R 755 "$DATA_DIR" 2>/dev/null || true
    }
    
    # Check if socket_proxy network exists (needed for autoheal)
    if ! docker network ls | grep -q socket_proxy; then
        log_info "Creating socket_proxy network..."
        docker network create socket_proxy 2>/dev/null || true
    fi
    
    # Generate .env if missing
    if [[ ! -f .env ]]; then
        log_info "Creating environment configuration..."
        SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || openssl rand -hex 32)
        cat > .env << EOF
# Portfolio Rebalancer Environment Configuration
# Generated automatically on $(date)

SECRET_KEY=$SECRET_KEY
DATABASE_URL=sqlite:///app/database/portfolio.db
FLASK_ENV=production
PYTHONUNBUFFERED=1
EOF
        log_success "Environment file created"
    fi
    
    # Build and start
    log_info "Building and starting containers..."
    $DOCKER_COMPOSE_CMD up -d --build
    
    # Update build marker
    touch .last_build_time
    
    # Wait for health check
    log_info "Waiting for application to be healthy..."
    for i in {1..20}; do
        sleep 3
        if is_app_healthy; then
            log_success "🎉 Rebuild completed successfully!"
            return 0
        elif [[ $i -eq 20 ]]; then
            log_error "Health check failed after 60 seconds"
            log_info "Check logs with: $DOCKER_COMPOSE_CMD logs $CONTAINER_NAME"
            return 1
        else
            log_info "Health check attempt $i/20..."
        fi
    done
}

# Perform quick update (now same as rebuild for consistency)
do_update() {
    log_info "🔨 Rebuilding to ensure latest code..."
    log_info "This will take ~1-2 minutes"
    
    DOCKER_COMPOSE_CMD=$(detect_docker_compose)
    
    # Stop containers first
    $DOCKER_COMPOSE_CMD down 2>/dev/null || true
    
    # Pull latest changes if this is a git repo
    if [[ -d .git ]]; then
        log_info "Pulling latest changes..."
        git pull origin main 2>/dev/null || git pull 2>/dev/null || true
    fi
    
    # Full rebuild with no cache to ensure latest code
    log_info "Building fresh containers..."
    $DOCKER_COMPOSE_CMD build --no-cache portfolio-app
    
    # Start containers
    $DOCKER_COMPOSE_CMD up -d
    
    # Update build marker
    touch .last_build_time
    
    # Wait for health check
    log_info "Waiting for application to be healthy..."
    for i in {1..15}; do
        sleep 4
        if is_app_healthy; then
            log_success "🎉 Rebuild completed successfully!"
            return 0
        elif [[ $i -eq 15 ]]; then
            log_error "Health check failed after 60 seconds"
            log_info "Check logs with: $DOCKER_COMPOSE_CMD logs $CONTAINER_NAME"
            return 1
        else
            log_info "Health check attempt $i/15..."
        fi
    done
}

# Main auto-management function
auto_manage() {
    echo -e "${BLUE}🚀 Portfolio Rebalancer - Auto Manager${NC}"
    echo "======================================="
    echo
    
    log_analyze "Analyzing current state..."
    
    # Check dependencies first
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        log_info "Please install Docker first: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Always check if rebuild is needed for first time or major changes
    if needs_rebuild; then
        do_rebuild
        return $?
    fi
    
    # For any other case, always rebuild to ensure latest code
    log_info "Ensuring latest code is deployed..."
    do_update
    return $?
}

# Parse command line arguments
case "${1:-}" in
    --status|-s)
        show_status
        ;;
    --help|-h)
        show_help
        ;;
    --force-rebuild|-f)
        log_info "🔨 Force rebuilding from scratch..."
        do_rebuild
        ;;
    "")
        auto_manage
        ;;
    *)
        log_error "Unknown argument: $1"
        echo "Use './app.sh --help' for usage information."
        exit 1
        ;;
esac
