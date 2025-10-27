#!/usr/bin/env python3
"""
Syntax check for Phase 2 files.
Compiles Python files to check for syntax errors without running them.
"""

import py_compile
import sys
from pathlib import Path

files_to_check = [
    'app/validation.py',
    'app/cache.py',
    'app/services/__init__.py',
    'app/services/allocation_service.py',
    'app/services/portfolio_service.py',
    'app/services/price_service.py',
    'app/repositories/__init__.py',
    'app/repositories/portfolio_repository.py',
    'tests/test_validation.py',
    'tests/test_services.py'
]

print("=" * 60)
print("PHASE 2 SYNTAX CHECK")
print("=" * 60)

all_valid = True

for file_path in files_to_check:
    try:
        py_compile.compile(file_path, doraise=True)
        print(f"✓ {file_path}")
    except py_compile.PyCompileError as e:
        print(f"✗ {file_path}")
        print(f"  Error: {e}")
        all_valid = False

print("=" * 60)

if all_valid:
    print("✓ ALL FILES PASSED SYNTAX CHECK")
    sys.exit(0)
else:
    print("✗ SOME FILES HAVE SYNTAX ERRORS")
    sys.exit(1)
