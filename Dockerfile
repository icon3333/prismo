FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies including su-exec
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    su-exec \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create app user for security
RUN useradd --create-home --shell /bin/bash app

# Copy application code
COPY . .

# Create entrypoint script
RUN echo '#!/bin/bash\n\
# Ensure data directories exist with correct permissions\n\
mkdir -p /data/database/backups /data/uploads\n\
chown -R app:app /data\n\
chmod -R 755 /data\n\
# Switch to app user and run the application\n\
exec su-exec app "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

# Set ownership of app directory
RUN chown -R app:app /app

# Expose port
EXPOSE 8065

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8065/health || exit 1

# Set entrypoint and default command
ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "--config", "gunicorn.conf.py", "run:app"] 