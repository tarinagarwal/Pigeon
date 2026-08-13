"""Database configuration and connection.

This module exposes two logical databases:

- ``db``: the main application database used by the user-facing product.
- ``admin_db``: an admin/system database intended for admin users, roles,
  automation rules, audit logs, and other operational data.

Both databases live in the same Mongo cluster (``MONGO_URL``) but can use
separate database names. In production you should set ``ADMIN_DB_NAME`` to
isolate admin/system data. If ``ADMIN_DB_NAME`` is not set, ``admin_db``
will fall back to the main ``DB_NAME`` for backwards compatibility.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Validate required environment variables for the primary app database
required_env_vars = ['MONGO_URL', 'DB_NAME']
missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)

# Main application database
db_name = os.environ['DB_NAME']
db = client[db_name]

# Admin/system database (optional override)
admin_db_name = os.getenv('ADMIN_DB_NAME')
if admin_db_name:
    admin_db = client[admin_db_name]
else:
    # Fall back to the main DB if ADMIN_DB_NAME is not provided.
    # This preserves existing behaviour while still allowing separation
    # when desired.
    logging.info(
        "ADMIN_DB_NAME not set; using main DB_NAME for admin/system data. "
        "Set ADMIN_DB_NAME to separate admin/system collections."
    )
    admin_db = db
