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
    
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
    if not SQLALCHEMY_DATABASE_URI:
        raise ValueError("DATABASE_URL environment variable must be set")
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

    # Session configuration
    PERMANENT_SESSION_LIFETIME = timedelta(days=1)
    SESSION_COOKIE_SECURE = True  # Only send cookies over HTTPS
    SESSION_COOKIE_HTTPONLY = True  # Prevent XSS attacks
    SESSION_COOKIE_SAMESITE = 'Lax'  # CSRF protection

    # Cache settings
    CACHE_TYPE = 'SimpleCache'
    CACHE_DEFAULT_TIMEOUT = 300  # 5 minutes

    # Database backup settings
    DB_BACKUP_DIR = os.path.join('app', 'database', 'backups')
    MAX_BACKUP_FILES = 10
    BACKUP_INTERVAL_HOURS = 6  # Automatic backup every 6 hours

    # Market data settings
    PRICE_UPDATE_INTERVAL = timedelta(hours=24)
    BATCH_SIZE = 5  # Number of tickers to fetch in a batch

    # Upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max upload
    UPLOAD_FOLDER = os.path.join('app', 'uploads')
    ALLOWED_EXTENSIONS = {'csv'}

    # Default number of items to show in pagination
    PER_PAGE = 20


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    SQLALCHEMY_ECHO = True
    SESSION_COOKIE_SECURE = False  # Allow HTTP in development


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
