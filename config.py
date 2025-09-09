import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Config:
    """Base configuration class."""
    SECRET_KEY = os.environ.get('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("SECRET_KEY environment variable must be set")
    if SECRET_KEY in ['CHANGE_THIS_SECRET_KEY', 'your-secret-key-here']:
        raise ValueError("SECRET_KEY must be changed from the default placeholder value")
    
    # Construct database URL from APP_DATA_DIR setting
    APP_DATA_DIR = os.environ.get('APP_DATA_DIR', 'instance')
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{APP_DATA_DIR}/portfolio.db"
    
    # Allow override via DATABASE_URL for advanced users (backward compatibility)
    if os.environ.get('DATABASE_URL'):
        SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
        if SQLALCHEMY_DATABASE_URI in ['CHANGE_THIS_DATABASE_URL']:
            raise ValueError("DATABASE_URL must be changed from the default placeholder value")
    
    # Validate FLASK_ENV
    FLASK_ENV = os.environ.get('FLASK_ENV', 'development')
    if FLASK_ENV == 'CHANGE_THIS_ENVIRONMENT':
        raise ValueError("FLASK_ENV must be changed from the default placeholder value")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Application settings
    DEBUG = False
    TESTING = False

    # Session configuration (configurable via environment variables)
    PERMANENT_SESSION_LIFETIME = timedelta(days=int(os.environ.get('SESSION_LIFETIME_DAYS', '1')))
    SESSION_COOKIE_SECURE = True  # Only send cookies over HTTPS
    SESSION_COOKIE_HTTPONLY = True  # Prevent XSS attacks
    SESSION_COOKIE_SAMESITE = 'Lax'  # CSRF protection

    # Cache settings (configurable via environment variables)
    CACHE_TYPE = 'SimpleCache'
    CACHE_DEFAULT_TIMEOUT = int(os.environ.get('CACHE_DEFAULT_TIMEOUT', '300'))  # 5 minutes default

    # Database backup settings (configurable via environment variables)
    DB_BACKUP_DIR = os.environ.get('DB_BACKUP_DIR', os.path.join(APP_DATA_DIR, 'backups'))
    MAX_BACKUP_FILES = int(os.environ.get('MAX_BACKUP_FILES', '10'))
    BACKUP_INTERVAL_HOURS = int(os.environ.get('BACKUP_INTERVAL_HOURS', '6'))  # Automatic backup every N hours

    # Market data settings (configurable via environment variables)
    PRICE_UPDATE_INTERVAL = timedelta(hours=int(os.environ.get('PRICE_UPDATE_INTERVAL_HOURS', '24')))
    BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '5'))  # Number of tickers to fetch in a batch

    # Upload settings (configurable via environment variables)
    MAX_CONTENT_LENGTH = int(os.environ.get('MAX_CONTENT_LENGTH', str(16 * 1024 * 1024)))  # 16MB max upload default
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join('app', 'uploads'))
    ALLOWED_EXTENSIONS = {'csv'}

    # Default number of items to show in pagination (configurable via environment variables)
    PER_PAGE = int(os.environ.get('PER_PAGE', '20'))


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    SQLALCHEMY_ECHO = os.environ.get('SQLALCHEMY_ECHO', 'true').lower() == 'true'
    SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() == 'true'  # Allow HTTP in development
    SESSION_COOKIE_SAMESITE = 'Lax'  # More permissive for local development
    SESSION_COOKIE_DOMAIN = None  # Allow cookies on localhost and IP addresses


class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    # Override database for testing (use in-memory SQLite)
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    SESSION_COOKIE_SECURE = False  # Allow HTTP in testing
    
    # Override parent class validation for testing
    def __init__(self):
        # Set required environment variables for testing if not present
        if not os.environ.get('SECRET_KEY'):
            os.environ['SECRET_KEY'] = 'test-secret-key-do-not-use-in-production'
        if not os.environ.get('DATABASE_URL'):
            os.environ['DATABASE_URL'] = 'sqlite:///:memory:'


class ProductionConfig(Config):
    """Production configuration."""
    # Explicitly disable debug mode in production
    DEBUG = False
    
    # Ensure HTTPS in production
    SESSION_COOKIE_SECURE = True
    
    # Additional production security headers
    SEND_FILE_MAX_AGE_DEFAULT = timedelta(hours=1)


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
