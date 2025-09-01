FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create app user for security
RUN useradd --create-home --shell /bin/bash app

# Copy application code
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p /data/database/backups /data/uploads \
    && chmod 755 /data /data/database /data/uploads \
    && chown -R app:app /app /data

# Switch to app user
USER app

# Expose port
EXPOSE 8065

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8065/health || exit 1

# Start application with gunicorn using configuration file
CMD ["gunicorn", "--config", "gunicorn.conf.py", "run:app"] 