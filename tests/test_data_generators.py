"""
Test Data Generators for CSV Upload Testing
Generates various CSV formats and edge cases for comprehensive testing.
"""

import random
from datetime import datetime, timedelta
from typing import List, Dict

# Basic valid CSV with mixed stocks and crypto
BASIC_CSV = """identifier;holdingname;shares;price;type;currency;date
AAPL;Apple Inc;100;150.00;buy;USD;2024-01-15
MSFT;Microsoft Corporation;50;300.00;buy;USD;2024-01-16
BTC-USD;Bitcoin;0.5;45000.00;buy;USD;2024-01-17
ETH-USD;Ethereum;2;3000.00;buy;USD;2024-01-18
GOOGL;Alphabet Inc Class A;25;2500.00;buy;USD;2024-01-19"""

# Edge cases CSV with various challenges
EDGE_CASES_CSV = """identifier;holdingname;shares;price;type;currency;date
AAPL;Apple Inc;100;150.00;buy;USD;2024-01-15
TSLA;Tesla Inc;50;250.50;buy;USD;2024-01-16
INVALID_SYMBOL;Unknown Company Ltd.;10;100.00;buy;USD;2024-01-17
BTC;Bitcoin;0.25;45000.00;buy;USD;2024-01-18
;Empty Identifier;5;50.00;buy;USD;2024-01-19
SPECIAL&CHARS;Company & Co. (Ltd.);15;200.00;buy;EUR;2024-01-20
BRK-B;Berkshire Hathaway Inc Class B;30;350.00;buy;USD;2024-01-21"""

# CSV with missing required columns
INVALID_CSV_MISSING_COLUMNS = """identifier;shares;price
AAPL;100;150.00
MSFT;50;300.00"""

# CSV with invalid data types
INVALID_CSV_BAD_DATA = """identifier;holdingname;shares;price;type;currency;date
AAPL;Apple Inc;invalid_number;150.00;buy;USD;2024-01-15
MSFT;Microsoft Corporation;50;not_a_price;buy;USD;2024-01-16"""

# CSV with only dividend transactions (should be skipped)
DIVIDEND_ONLY_CSV = """identifier;holdingname;shares;price;type;currency;date
AAPL;Apple Inc;0;2.50;dividend;USD;2024-01-15
MSFT;Microsoft Corporation;0;3.00;dividend;USD;2024-01-16"""

# CSV with mixed transaction types
MIXED_TRANSACTIONS_CSV = """identifier;holdingname;shares;price;type;currency;date
AAPL;Apple Inc;100;150.00;buy;USD;2024-01-15
AAPL;Apple Inc;0;2.50;dividend;USD;2024-01-16
MSFT;Microsoft Corporation;50;300.00;buy;USD;2024-01-17
TSLA;Tesla Inc;25;250.00;transferin;USD;2024-01-18"""

# Empty CSV file
EMPTY_CSV = ""

# CSV with only headers
HEADER_ONLY_CSV = """identifier;holdingname;shares;price;type;currency;date"""

def generate_large_csv(num_rows: int) -> str:
    """
    Generate large CSV for performance testing with realistic data.
    """
    symbols_and_companies = [
        ('AAPL', 'Apple Inc'),
        ('MSFT', 'Microsoft Corporation'),
        ('GOOGL', 'Alphabet Inc Class A'),
        ('TSLA', 'Tesla Inc'),
        ('NVDA', 'NVIDIA Corporation'),
        ('AMZN', 'Amazon.com Inc'),
        ('META', 'Meta Platforms Inc'),
        ('BRK-B', 'Berkshire Hathaway Inc Class B'),
        ('JNJ', 'Johnson & Johnson'),
        ('JPM', 'JPMorgan Chase & Co'),
        ('BTC-USD', 'Bitcoin'),
        ('ETH-USD', 'Ethereum'),
        ('ADA-USD', 'Cardano'),
        ('SOL-USD', 'Solana'),
        ('BNB-USD', 'Binance Coin'),
    ]
    
    header = "identifier;holdingname;shares;price;type;currency;date\n"
    rows = []
    
    for i in range(num_rows):
        symbol, company = random.choice(symbols_and_companies)
        shares = random.randint(1, 1000) if not symbol.endswith('-USD') else round(random.uniform(0.1, 10), 3)
        
        # Realistic price ranges
        if symbol.endswith('-USD'):  # Crypto
            price = random.uniform(100, 50000)
        else:  # Stocks
            price = random.uniform(10, 500)
        
        transaction_type = random.choice(['buy', 'buy', 'buy', 'transferin'])  # Mostly buys
        currency = 'USD'
        date = datetime.now() - timedelta(days=random.randint(1, 365))
        
        row = f"{symbol};{company};{shares};{price:.2f};{transaction_type};{currency};{date.strftime('%Y-%m-%d')}"
        rows.append(row)
    
    return header + "\n".join(rows)

def generate_stress_test_csv() -> str:
    """
    Generate CSV with stress test conditions:
    - Very long company names
    - Special characters
    - Edge case numbers
    - Mixed currencies
    """
    return """identifier;holdingname;shares;price;type;currency;date
AAPL;"Apple Inc. with very long name that contains special characters & symbols (2024)";100;150.00;buy;USD;2024-01-15
MSFT;Microsoft Corporation™ ® © Ltd.;0.000001;999999.99;buy;EUR;2024-01-16
SPECIAL-123;Company with-dashes_and_underscores & ampersands;99999;0.01;buy;GBP;2024-01-17
BTC-USD;₿itcoin with Unicode Characters 🚀;0.00000001;45000.00;buy;USD;2024-01-18"""

def generate_csv_variants() -> Dict[str, str]:
    """
    Generate different CSV format variants to test parser robustness.
    """
    base_data = [
        ['AAPL', 'Apple Inc', '100', '150.00', 'buy', 'USD', '2024-01-15'],
        ['MSFT', 'Microsoft Corporation', '50', '300.00', 'buy', 'USD', '2024-01-16'],
        ['BTC-USD', 'Bitcoin', '0.5', '45000.00', 'buy', 'USD', '2024-01-17']
    ]
    
    variants = {}
    
    # Semicolon delimiter (default)
    variants['semicolon'] = "identifier;holdingname;shares;price;type;currency;date\n"
    for row in base_data:
        variants['semicolon'] += ";".join(row) + "\n"
    
    # Comma delimiter
    variants['comma'] = "identifier,holdingname,shares,price,type,currency,date\n"
    for row in base_data:
        variants['comma'] += ",".join(row) + "\n"
    
    # Tab delimiter
    variants['tab'] = "identifier\tholdingname\tshares\tprice\ttype\tcurrency\tdate\n"
    for row in base_data:
        variants['tab'] += "\t".join(row) + "\n"
    
    # Pipe delimiter
    variants['pipe'] = "identifier|holdingname|shares|price|type|currency|date\n"
    for row in base_data:
        variants['pipe'] += "|".join(row) + "\n"
    
    # With BOM (Byte Order Mark)
    variants['with_bom'] = "\ufeff" + variants['semicolon']
    
    # With extra whitespace
    variants['whitespace'] = " identifier ; holdingname ; shares ; price ; type ; currency ; date \n"
    for row in base_data:
        variants['whitespace'] += " " + " ; ".join(row) + " \n"
    
    return variants

def generate_real_world_csv() -> str:
    """
    Generate realistic CSV that mimics actual portfolio export data.
    """
    return """identifier;holdingname;shares;price;type;currency;broker;date;fee;tax
AAPL;Apple Inc;100;150.00;buy;USD;Interactive Brokers;2024-01-15;1.00;0.00
MSFT;Microsoft Corporation;50;300.00;buy;USD;Interactive Brokers;2024-01-16;1.00;0.00
GOOGL;Alphabet Inc Class A;25;2500.00;buy;USD;Charles Schwab;2024-01-17;0.00;0.00
TSLA;Tesla Inc;75;250.00;buy;USD;Robinhood;2024-01-18;0.00;0.00
BTC-USD;Bitcoin;0.5;45000.00;buy;USD;Coinbase;2024-01-19;25.00;0.00
ETH-USD;Ethereum;2.5;3000.00;buy;USD;Coinbase;2024-01-20;15.00;0.00
VTI;Vanguard Total Stock Market ETF;200;220.00;buy;USD;Vanguard;2024-01-21;0.00;0.00
SPY;SPDR S&P 500 ETF Trust;150;450.00;buy;USD;Fidelity;2024-01-22;0.00;0.00"""

def generate_international_csv() -> str:
    """
    Generate CSV with international stocks and different exchanges.
    """
    return """identifier;holdingname;shares;price;type;currency;date
ASML;ASML Holding NV;50;700.00;buy;EUR;2024-01-15
SAP;SAP SE;75;120.00;buy;EUR;2024-01-16
NESN.SW;Nestle SA;100;110.00;buy;CHF;2024-01-17
7203.T;Toyota Motor Corp;200;2500.00;buy;JPY;2024-01-18
0700.HK;Tencent Holdings Ltd;300;400.00;buy;HKD;2024-01-19
005930.KS;Samsung Electronics Co Ltd;100;70000.00;buy;KRW;2024-01-20"""

class CSVTestData:
    """
    Centralized test data management for CSV testing.
    """
    
    @staticmethod
    def get_all_test_cases() -> Dict[str, str]:
        """Get all test CSV cases for comprehensive testing."""
        return {
            'basic': BASIC_CSV,
            'edge_cases': EDGE_CASES_CSV,
            'invalid_missing_columns': INVALID_CSV_MISSING_COLUMNS,
            'invalid_bad_data': INVALID_CSV_BAD_DATA,
            'dividend_only': DIVIDEND_ONLY_CSV,
            'mixed_transactions': MIXED_TRANSACTIONS_CSV,
            'empty': EMPTY_CSV,
            'header_only': HEADER_ONLY_CSV,
            'stress_test': generate_stress_test_csv(),
            'real_world': generate_real_world_csv(),
            'international': generate_international_csv(),
            'large_100': generate_large_csv(100),
            'large_500': generate_large_csv(500),
        }
    
    @staticmethod
    def get_format_variants() -> Dict[str, str]:
        """Get different CSV format variants."""
        return generate_csv_variants()
    
    @staticmethod
    def get_performance_test_data() -> List[tuple]:
        """Get test data for performance testing (row_count, expected_max_seconds)."""
        return [
            (10, 5),     # 10 rows, max 5 seconds
            (50, 15),    # 50 rows, max 15 seconds
            (100, 30),   # 100 rows, max 30 seconds
            (250, 60),   # 250 rows, max 1 minute
            (500, 120),  # 500 rows, max 2 minutes
        ]
