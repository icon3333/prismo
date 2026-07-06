# Gunicorn configuration file
# This file is used by gunicorn to configure the application server

import os

# create_app() must not self-start background tasks under gunicorn: with
# preload_app the app is built in the gunicorn master before fork, and any
# thread started there would never exist in the workers. when_ready() below
# starts them exactly once in the master instead (dev via run.py is unaffected).
os.environ['PRISMO_DEFER_STARTUP_TASKS'] = '1'

# Server socket
bind = "0.0.0.0:8065"
backlog = 2048

# Worker processes.
# Single-user homeserver on SQLite: one process with a thread pool.
# Multiple processes would each hold their own SimpleCache, so the
# after_request cache invalidation on writes only ever clears the worker
# that handled the write - other workers would serve stale reads.
workers = 1
worker_class = "gthread"
threads = 8
worker_connections = 1000
timeout = 120
keepalive = 2

# No request-based worker recycling: a worker restart would kill in-flight
# background threads (CSV imports, batch price updates) mid-job.
max_requests = 0

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

def when_ready(server):
    # Add custom filter to Gunicorn's access logger
    import logging
    access_logger = logging.getLogger("gunicorn.access")
    access_logger.addFilter(HealthCheckFilter())

    # Start backup scheduler / exchange-rate refresh / price auto-update in
    # the master process, exactly once. Runs here (not in workers) so the
    # 6-hour backup loop survives any worker restart.
    from app.utils.startup_tasks import start_background_tasks
    flask_app = server.app.wsgi()  # already loaded thanks to preload_app
    start_background_tasks(flask_app)

# Process naming
proc_name = "prismo"

# Server mechanics
daemon = False
pidfile = "/tmp/gunicorn.pid"
tmp_upload_dir = None

# Security
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
