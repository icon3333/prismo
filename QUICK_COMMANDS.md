# Portfolio Rebalancer - Quick Commands

## 🚀 **One Command to Rule Them All**

### Primary Command (90% of usage)
```bash
./app.sh
```
*Automatically handles everything: first deployment, updates, rebuilds, fixes*

### Status Check
```bash
./app.sh --status
```
*Quick status check of all services*

### Help
```bash
./app.sh --help
```
*Show all available options*

### Manual Health Check
```bash
curl -s http://localhost:8065/health
```

---

## 🐳 **Docker Commands**

### View Logs
```bash
# All services
docker compose logs -f

# Portfolio app only
docker compose logs -f portfolio-app

# Autoheal only
docker compose logs -f autoheal
```

### Restart Services
```bash
# Restart all
docker compose restart

# Restart app only
docker compose restart portfolio-app

# Restart autoheal only
docker compose restart autoheal
```

### Stop/Start
```bash
# Stop all
docker compose down

# Start all
docker compose up -d

# Start specific service
docker compose up -d portfolio-app
```

---

## 🔧 **Troubleshooting**

### Container Not Starting
```bash
# Check logs
docker compose logs portfolio-app

# Rebuild completely
docker compose down
docker compose up -d --build
```

### Database Issues
```bash
# Check database directory
ls -la /data/database/

# Fix permissions
sudo chown -R $(whoami):$(whoami) /data
sudo chmod -R 755 /data
```

### Autoheal Not Working
```bash
# Check autoheal logs
docker compose logs autoheal

# Check if socket_proxy network exists
docker network ls | grep socket_proxy

# Create network if missing
docker network create socket_proxy
```

---

## 📊 **Monitoring**

### Check Container Status
```bash
docker compose ps
```

### Check Health Status
```bash
docker inspect portfolio_rebalancer | grep Health -A 10
```

### Monitor Resource Usage
```bash
docker stats portfolio_rebalancer
```

---

## ⚡ **Performance**

### Build Time Optimization
- `.dockerignore` excludes unnecessary files
- Use `./quick-update.sh` for faster updates
- Full rebuild only when needed

### Update Workflow
1. **Any changes**: `./app.sh` (auto-detects: ~30s for updates, ~3min for rebuilds)
2. **Check status**: `./app.sh --status`
3. **That's it!** The script handles everything automatically

---

## 🔐 **Security Features**

### Autoheal Configuration
- Monitors container health every 30 seconds
- Automatically restarts failed containers
- Runs with minimal privileges
- Uses socket proxy for Docker access

### Container Security
- Non-root user (app:app)
- Read-only environment file mount
- Proper file permissions
- Health checks enabled
