"""
Manual Testing Script for Simplified CSV Upload
Interactive script to test the new simplified upload system.
"""

import os
import sys
import time
from tests.test_data_generators import CSVTestData, generate_large_csv

# Add project root to path
sys.path.insert(0, '/Users/nico/Documents/Interests/TECH/coding/_FINANCE/portfolio_rebalancing_flask')

def print_header(title):
    """Print formatted test section header."""
    print(f"\n{'='*60}")
    print(f"🧪 {title}")
    print('='*60)

def print_test(test_name):
    """Print test name and wait for user confirmation."""
    print(f"\n▶️  {test_name}")
    input("Press Enter to continue or Ctrl+C to skip...")

def save_test_csv(filename, content):
    """Save CSV content to file for manual testing."""
    test_dir = "/tmp/csv_test_files"
    os.makedirs(test_dir, exist_ok=True)
    
    filepath = os.path.join(test_dir, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"📁 Test file saved: {filepath}")
    return filepath

def manual_test_checklist():
    """
    Interactive manual testing checklist for the simplified CSV upload system.
    """
    
    print_header("Simplified CSV Upload Manual Testing")
    
    print("🚀 Welcome to the simplified CSV upload testing script!")
    print("This script will guide you through comprehensive manual testing.")
    print("\nPrerequisites:")
    print("✅ Flask app is running (python run.py)")
    print("✅ You're logged into the application")
    print("✅ You have access to the portfolio upload page")
    
    input("\nPress Enter to start testing...")
    
    # Generate test files
    print_header("Generating Test Files")
    
    test_files = {}
    test_data = CSVTestData.get_all_test_cases()
    
    # Save basic test files
    print("📝 Generating test CSV files...")
    test_files['basic'] = save_test_csv('01_basic_portfolio.csv', test_data['basic'])
    test_files['edge_cases'] = save_test_csv('02_edge_cases.csv', test_data['edge_cases'])
    test_files['mixed_transactions'] = save_test_csv('03_mixed_transactions.csv', test_data['mixed_transactions'])
    test_files['international'] = save_test_csv('04_international_stocks.csv', test_data['international'])
    test_files['real_world'] = save_test_csv('05_real_world_example.csv', test_data['real_world'])
    
    # Generate performance test files
    test_files['medium'] = save_test_csv('06_medium_100_rows.csv', generate_large_csv(100))
    test_files['large'] = save_test_csv('07_large_500_rows.csv', generate_large_csv(500))
    
    # Generate invalid files for error testing
    test_files['invalid_format'] = save_test_csv('08_invalid_format.csv', test_data['invalid_missing_columns'])
    test_files['invalid_data'] = save_test_csv('09_invalid_data.csv', test_data['invalid_bad_data'])
    
    print(f"\n✅ Generated {len(test_files)} test files in /tmp/csv_test_files/")
    
    # Manual testing checklist
    print_header("Manual Testing Checklist")
    
    tests = [
        {
            'name': 'Basic Portfolio Upload (5 stocks + crypto)',
            'file': test_files['basic'],
            'expected': 'Should complete in < 30 seconds, import 5 positions',
            'notes': 'Watch for progress indication, no browser refresh'
        },
        {
            'name': 'Edge Cases Upload (special characters, invalid symbols)',
            'file': test_files['edge_cases'],
            'expected': 'Should handle errors gracefully, import valid rows',
            'notes': 'Should show partial success message with error count'
        },
        {
            'name': 'Mixed Transaction Types',
            'file': test_files['mixed_transactions'],
            'expected': 'Should skip dividends, import only buy/transferin',
            'notes': 'Check that dividend transactions are not imported'
        },
        {
            'name': 'International Stocks',
            'file': test_files['international'],
            'expected': 'Should handle different exchanges (JP, HK, KR, etc.)',
            'notes': 'Verify foreign exchange symbols work correctly'
        },
        {
            'name': 'Real-world Example with Fees/Taxes',
            'file': test_files['real_world'],
            'expected': 'Should import realistic portfolio data',
            'notes': 'Check that fees and taxes are handled properly'
        },
        {
            'name': 'Medium File Performance (100 rows)',
            'file': test_files['medium'],
            'expected': 'Should complete in < 60 seconds',
            'notes': 'Time the upload, should show steady progress'
        },
        {
            'name': 'Large File Performance (500 rows)',
            'file': test_files['large'],
            'expected': 'Should complete in < 120 seconds',
            'notes': 'Test system performance with larger dataset'
        },
        {
            'name': 'Invalid Format Handling',
            'file': test_files['invalid_format'],
            'expected': 'Should fail with clear error message',
            'notes': 'Should not crash, show missing columns error'
        },
        {
            'name': 'Invalid Data Handling',
            'file': test_files['invalid_data'],
            'expected': 'Should show validation errors',
            'notes': 'Should handle bad numeric data gracefully'
        }
    ]
    
    print(f"📋 Manual Test Cases ({len(tests)} total)")
    print("For each test:")
    print("1. Upload the specified file via the web interface")
    print("2. Verify the expected outcome")
    print("3. Check the notes for specific things to watch")
    print("4. Mark ✅ if passed, ❌ if failed\n")
    
    results = []
    
    for i, test in enumerate(tests, 1):
        print(f"\n🧪 Test {i}/{len(tests)}: {test['name']}")
        print(f"📁 File: {test['file']}")
        print(f"🎯 Expected: {test['expected']}")
        print(f"📝 Notes: {test['notes']}")
        
        result = input("Result (✅ pass / ❌ fail / ⏭️ skip): ").strip()
        
        if result.lower() in ['✅', 'pass', 'p', 'yes', 'y']:
            results.append('✅ PASS')
            print("✅ Test marked as PASSED")
        elif result.lower() in ['❌', 'fail', 'f', 'no', 'n']:
            results.append('❌ FAIL')
            error = input("Error details (optional): ")
            print(f"❌ Test marked as FAILED: {error}")
        else:
            results.append('⏭️ SKIP')
            print("⏭️ Test skipped")
    
    # Additional manual tests
    print_header("Additional Manual Tests")
    
    additional_tests = [
        "🔐 Upload without authentication (should fail with 401)",
        "📄 Upload without selecting file (should show error)",
        "🈚 Upload empty file (should show validation error)",
        "🔧 Upload while network is disconnected (should handle gracefully)",
        "🖥️ Test on different browsers (Chrome, Firefox, Safari)",
        "📱 Test on mobile device (responsive design)",
        "🔄 Upload same file twice (should update positions correctly)",
        "🧪 Upload file with BOM (Byte Order Mark) - Excel export",
        "🌍 Upload file with non-ASCII characters (international names)",
        "⚡ Monitor browser console for JavaScript errors during upload"
    ]
    
    print("📋 Additional Manual Verification Tests:")
    for test in additional_tests:
        result = input(f"{test} (✅/❌/⏭️): ").strip()
        if result.lower() in ['✅', 'pass', 'p']:
            results.append('✅ PASS')
        elif result.lower() in ['❌', 'fail', 'f']:
            results.append('❌ FAIL')
        else:
            results.append('⏭️ SKIP')
    
    # Results Summary
    print_header("Testing Results Summary")
    
    total_tests = len(tests) + len(additional_tests)
    passed = results.count('✅ PASS')
    failed = results.count('❌ FAIL')
    skipped = results.count('⏭️ SKIP')
    
    print(f"📊 Test Results:")
    print(f"   ✅ Passed: {passed}/{total_tests}")
    print(f"   ❌ Failed: {failed}/{total_tests}")
    print(f"   ⏭️ Skipped: {skipped}/{total_tests}")
    
    if failed == 0:
        print("\n🎉 ALL TESTS PASSED! The simplified CSV upload system is working correctly.")
        print("🚀 Ready for production deployment!")
    else:
        print(f"\n⚠️  {failed} tests failed. Please review and fix issues before deployment.")
    
    print(f"\n📁 Test files are saved in /tmp/csv_test_files/ for reference")
    print("🧹 You can delete them with: rm -rf /tmp/csv_test_files/")

def quick_smoke_test():
    """
    Quick smoke test for basic functionality.
    """
    print_header("Quick Smoke Test")
    
    print("🚀 Running quick smoke test...")
    
    # Test basic CSV generation
    print("📝 Testing CSV generation...")
    basic_csv = CSVTestData.get_all_test_cases()['basic']
    assert len(basic_csv) > 100, "Basic CSV should have content"
    print("✅ CSV generation works")
    
    # Test identifier normalization
    print("🔤 Testing identifier normalization...")
    from app.utils.csv_import_simple import normalize_simple
    assert normalize_simple('AAPL') == 'AAPL'
    assert normalize_simple('BTC') == 'BTC-USD'
    print("✅ Identifier normalization works")
    
    # Test CSV validation
    print("✅ Testing CSV validation...")
    from app.utils.csv_import_simple import validate_csv_format
    valid, msg = validate_csv_format(basic_csv)
    assert valid == True, f"Basic CSV should be valid: {msg}"
    print("✅ CSV validation works")
    
    print("\n🎉 Quick smoke test completed successfully!")
    print("🧪 Run full manual tests with: python tests/manual_testing_script.py")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Manual testing for simplified CSV upload')
    parser.add_argument('--quick', action='store_true', help='Run quick smoke test only')
    args = parser.parse_args()
    
    if args.quick:
        quick_smoke_test()
    else:
        manual_test_checklist()
