#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[start-services]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[start-services]${NC} $1"
}

error() {
    echo -e "${RED}[start-services]${NC} $1"
}

# PostgreSQL configuration
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
POSTGRES_USER="${POSTGRES_USER:-letta}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-letta}"
POSTGRES_DB="${POSTGRES_DB:-letta}"

# Letta configuration
LETTA_PORT="${LETTA_PORT:-8283}"
LETTA_VENV="/opt/letta-venv"

# Initialize PostgreSQL if needed
init_postgres() {
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
        log "Initializing PostgreSQL database..."
        sudo -u postgres /usr/lib/postgresql/*/bin/initdb -D "$PGDATA"
        
        # Configure PostgreSQL for local connections
        echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
        echo "local all all trust" >> "$PGDATA/pg_hba.conf"
        
        # Configure PostgreSQL to listen on localhost
        echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
        
        log "PostgreSQL initialized"
    else
        log "PostgreSQL data directory already exists"
    fi
}

# Start PostgreSQL
start_postgres() {
    log "Starting PostgreSQL..."
    sudo -u postgres /usr/lib/postgresql/*/bin/pg_ctl -D "$PGDATA" -l /var/log/postgresql/postgresql.log start
    
    # Wait for PostgreSQL to be ready
    log "Waiting for PostgreSQL to be ready..."
    local retries=30
    while ! sudo -u postgres /usr/lib/postgresql/*/bin/pg_isready -q; do
        retries=$((retries - 1))
        if [ $retries -eq 0 ]; then
            error "PostgreSQL failed to start"
            exit 1
        fi
        sleep 1
    done
    log "PostgreSQL is ready"
}

# Create database and user if needed
setup_database() {
    log "Setting up database..."
    
    # Create user if not exists
    sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_USER'" | grep -q 1 || \
        sudo -u postgres psql -c "CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';"
    
    # Create database if not exists
    sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1 || \
        sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"
    
    # Grant privileges
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;"
    
    log "Database setup complete"
}

# Start Letta server
start_letta() {
    log "Starting Letta server on port $LETTA_PORT..."
    
    # Create log directory
    sudo mkdir -p /var/log/letta
    sudo chown vscode:vscode /var/log/letta
    
    # Start Letta in background
    nohup $LETTA_VENV/bin/letta server --port $LETTA_PORT > /var/log/letta/letta.log 2>&1 &
    LETTA_PID=$!
    echo $LETTA_PID > /tmp/letta.pid
    
    # Wait for Letta to be ready
    log "Waiting for Letta to be ready..."
    local retries=60
    while ! curl -s http://localhost:$LETTA_PORT/v1/health > /dev/null 2>&1; do
        retries=$((retries - 1))
        if [ $retries -eq 0 ]; then
            error "Letta failed to start. Check /var/log/letta/letta.log"
            cat /var/log/letta/letta.log
            exit 1
        fi
        sleep 2
    done
    
    log "Letta is ready on http://localhost:$LETTA_PORT"
}

# Check if Copilot API is available (optional)
check_copilot_api() {
    local api_base="${OPENAI_API_BASE:-http://localhost:4141/v1}"
    
    if curl -s "$api_base/models" > /dev/null 2>&1; then
        log "Copilot API is available at $api_base"
    else
        warn "Copilot API not detected at $api_base"
        warn "Run 'npx copilot-api@latest start --port 4141' on host machine"
        warn "Letta will start but may have limited functionality until API is available"
    fi
}

# Main
main() {
    log "Starting oh-my-opencode devcontainer services..."
    
    # Create log directories
    sudo mkdir -p /var/log/postgresql
    sudo chown postgres:postgres /var/log/postgresql
    
    # Initialize and start PostgreSQL
    init_postgres
    start_postgres
    setup_database
    
    # Check for Copilot API (informational)
    check_copilot_api
    
    # Start Letta
    start_letta
    
    log "All services started successfully!"
    log ""
    log "Services:"
    log "  - PostgreSQL: localhost:5432"
    log "  - Letta: http://localhost:$LETTA_PORT"
    log ""
    log "To use OpenCode with Letta memory, run: opencode"
    log ""
    log "Logs:"
    log "  - PostgreSQL: /var/log/postgresql/postgresql.log"
    log "  - Letta: /var/log/letta/letta.log"
}

main "$@"
