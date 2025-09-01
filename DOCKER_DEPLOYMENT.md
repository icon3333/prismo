# 🐳 Docker Deployment Guide

## Quick Start

**One-command deployment on your destination machine:**

```bash
git clone <your-github-repo>
cd portfolio_rebalancing_flask
chmod +x deploy.sh
./deploy.sh
```

That's it! The script handles everything automatically.

## What the Deployment Does

### 🚀 Automated Setup
- ✅ Checks Docker/Docker Compose installation
- ✅ Creates `/data` directory structure 
- ✅ Generates secure environment configuration
- ✅ Migrates existing database (if found)
- ✅ Builds and starts Docker container
- ✅ Verifies deployment with health checks

### 📁 Directory Structure
```
/data/
├── database/
│   ├── portfolio.db          # Main SQLite database
│   └── backups/              # Automatic backups
├── uploads/                  # CSV file uploads
└── backups/                  # Migration backups
```

### 🔧 Container Configuration
- **Port**: 8065 (configurable)
- **Database**: SQLite in `/data/database/portfolio.db`
- **Persistence**: All data stored in `/data` directory
- **Health Check**: Automatic monitoring at `/health`
- **Restart Policy**: `unless-stopped`

## Advanced Usage

### Custom Port
```bash
./deploy.sh --port 8066
```

### Custom Data Directory
```bash
./deploy.sh --data-dir /custom/path
```

### Manual Environment Setup
```bash
# Copy template and edit
cp env.example .env
nano .env  # Edit values as needed
./deploy.sh
```

## Management Commands

### View Application Status
```bash
# Check if running
docker ps | grep portfolio

# View logs
docker-compose logs -f

# Check health
curl http://localhost:8065/health
```

### Control Application
```bash
# Stop application
docker-compose down

# Restart application  
docker-compose restart

# Update application
git pull
docker-compose build
docker-compose up -d
```

### Database Operations
```bash
# Access database directly
docker-compose exec portfolio-app sqlite3 /data/database/portfolio.db

# Create manual backup
docker-compose exec portfolio-app python -c "
from app.database.db_manager import backup_database
from app.main import create_app
app = create_app('production')
with app.app_context():
    backup_file = backup_database()
    print(f'Backup created: {backup_file}')
"
```

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs

# Check environment
cat .env

# Rebuild from scratch
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Permission Issues
```bash
# Fix data directory permissions
sudo chown -R $(id -u):$(id -g) /data
sudo chmod -R 755 /data
```

### Health Check Fails
```bash
# Check application logs
docker-compose logs portfolio-app

# Test database connection
docker-compose exec portfolio-app python -c "
from app.database.db_manager import query_db
from app.main import create_app
app = create_app('production')
with app.app_context():
    result = query_db('SELECT 1', one=True)
    print('Database OK' if result else 'Database Error')
"
```

### Migration Issues
```bash
# Check if database exists
ls -la /data/database/

# Check backups
ls -la /data/backups/

# Manual migration
cp app/database/portfolio.db /data/database/portfolio.db
docker-compose restart
```

## Security Notes

- ✅ Application runs as non-root user
- ✅ Secure secret key generation
- ✅ Database files outside container
- ✅ Environment variables isolated
- ✅ Health check monitoring

## Integration with Existing Infrastructure

Since you have nginx/reverse proxy already configured:

1. **Point your reverse proxy to**: `http://localhost:8065`
2. **Health check endpoint**: `http://localhost:8065/health` 
3. **Static files**: Can be served by your existing nginx if needed
4. **SSL**: Handled by your existing infrastructure

## Backup Strategy

### Automatic Backups
- Database backups created automatically by the application
- Stored in `/data/database/backups/`
- Configurable retention policy

### Manual Backup Script
```bash
#!/bin/bash
# backup-portfolio.sh
DATE=$(date +%Y%m%d_%H%M%S)
tar czf "/backup/portfolio_full_$DATE.tar.gz" /data
echo "Full backup created: portfolio_full_$DATE.tar.gz"
```

## Monitoring

### Health Check Integration
```bash
# Add to your monitoring system
curl -f http://localhost:8065/health || alert_admin
```

### Log Monitoring
```bash
# Follow logs
docker-compose logs -f portfolio-app

# Check for errors
docker-compose logs portfolio-app | grep ERROR
```

## Performance Optimization

### Container Resources
```yaml
# Add to docker-compose.yml under portfolio-app service
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 1G
    reservations:
      cpus: '0.5' 
      memory: 512M
```

### Database Optimization
- Regular VACUUM operations
- Index optimization
- Backup cleanup

This deployment is production-ready and integrates seamlessly with your existing infrastructure! 