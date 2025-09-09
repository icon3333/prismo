# Gunicorn configuration file
# This file is used by gunicorn to configure the application server

# Server socket
bind = "0.0.0.0:8065"
backlog = 2048

# Worker processes
workers = 4
worker_class = "sync"
worker_connections = 1000
timeout = 120
keepalive = 2
max_requests = 1000
max_requests_jitter = 100

# Restart workers after this many requests, to help prevent memory leaks
preload_app = True

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Custom access log filter to suppress health check logs
class HealthCheckFilter:
    def filter(self, record):
        # Suppress logs for successful health checks to reduce noise
        # Check if this is an access log message containing '/health'
        if hasattr(record, 'getMessage'):
            message = record.getMessage()
            return not ('/health' in message and ' 200 ' in message)
        return True

# Apply the filter to suppress health check access logs
def when_ready(server):
    # Add custom filter to Gunicorn's access logger
    import logging
    access_logger = logging.getLogger("gunicorn.access")
    access_logger.addFilter(HealthCheckFilter())

# Process naming
proc_name = "portfolio_rebalancer"

# Server mechanics
daemon = False
pidfile = "/tmp/gunicorn.pid"
tmp_upload_dir = None

# Security
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190 