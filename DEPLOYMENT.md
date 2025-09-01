# Production Deployment Guide

## Pre-Deployment Security Checklist ✅

### Critical Security Issues Fixed:
1. ✅ **SSH private keys removed** from repository
2. ✅ **Database files properly ignored** by git
3. ✅ **No hardcoded secrets** in source code
4. ✅ **Enhanced .gitignore** with comprehensive security patterns
5. ✅ **Production-ready configuration** with security headers

## Environment Setup

### 1. Generate Secret Key
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Set Environment Variables

#### Option A: Automatic Setup
```bash
# Development setup (automatic, no prompts)
python run.py --port 8000

# Or manual setup:
# Development environment
python setup_env.py

# Production environment
python setup_env.py --production

# Interactive setup (advanced users)
python setup_env.py --interactive
```

#### Option B: Manual Environment Setup
```bash
export SECRET_KEY="your-generated-secret-key"
export DATABASE_URL="postgresql://user:pass@localhost/portfolio_db"  # or SQLite for small deployments
export FLASK_ENV="production"
```

#### Option C: Use .env File (Recommended for Production)
```bash
# Generate a secure secret key
SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"

# Create .env file with your production values
echo "SECRET_KEY=$SECRET_KEY" > .env
echo "DATABASE_URL=postgresql://user:pass@localhost/portfolio_db" >> .env
echo "FLASK_ENV=production" >> .env
```

⚠️ **CRITICAL**: Never use placeholder values in production! The app will refuse to start with default/placeholder values.

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

## Deployment Options

### Option 1: Simple Server (Gunicorn)
```bash
gunicorn -w 4 -b 0.0.0.0:8000 run:app
```

### Option 2: Docker Deployment
Create `Dockerfile`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "run:app"]
```

### Option 3: Cloud Deployment (Heroku/Railway/DigitalOcean)
1. Set environment variables in platform dashboard
2. Use provided buildpacks for Python
3. Ensure `requirements.txt` and `run.py` are in root

## Database Migration for Production

### PostgreSQL Setup (Recommended)
```bash
# Install PostgreSQL driver
pip install psycopg2-binary

# Update DATABASE_URL
export DATABASE_URL="postgresql://username:password@localhost/portfolio_db"
```

### SQLite (Development/Small Deployments)
```bash
# Default configuration uses SQLite
# Database will be created at app/database/portfolio.db
```

## Reverse Proxy Configuration (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Security headers
        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options DENY;
        add_header X-XSS-Protection "1; mode=block";
    }
}
```

## Security Monitoring

### Log Important Events
- Failed login attempts
- Database connection errors
- File upload attempts
- Unusual portfolio access patterns

### Backup Strategy
```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 app/database/portfolio.db ".backup app/database/backups/backup_$DATE.db"
```

## Performance Optimization

### 1. Enable Caching
- Configure Redis/Memcached for production
- Cache market data for specified intervals

### 2. Database Optimization
- Add indexes for frequently queried columns
- Implement connection pooling for PostgreSQL

### 3. Static File Serving
- Use CDN for static assets
- Configure proper cache headers

## Health Checks

Create `/health` endpoint:
```python
@app.route('/health')
def health_check():
    return {'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()}
```

## Repository Status: ✅ READY FOR PUBLIC RELEASE

Your repository is now safe to make public with proper production deployment following this guide. 