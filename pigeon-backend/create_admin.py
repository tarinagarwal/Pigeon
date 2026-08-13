#!/usr/bin/env python3
"""Script to create an admin user for the Pigeon admin panel."""

import asyncio
import os
from pathlib import Path
import sys

# Add backend directory to Python path
sys.path.append(str(Path(__file__).parent))

from database import admin_db
from admin_models import AdminUser
from routes.auth_utils import get_password_hash

async def create_admin_user():
    """Create an admin user in the database."""
    
    # Check if admin user already exists
    existing_admin = await admin_db.admin_users.find_one({"email": "admin@example.com"})
    if existing_admin:
        print("Admin user already exists!")
        return
    
    # Create admin user
    admin_user = AdminUser(
        email="admin@example.com",
        password_hash=get_password_hash("admin123"),
        is_super_admin=True,
        status="active"
    )
    
    # Insert into database
    result = await admin_db.admin_users.insert_one(admin_user.model_dump())
    
    if result.inserted_id:
        print("✅ Admin user created successfully!")
        print("Email: admin@example.com")
        print("Password: admin123")
        print("\n⚠️  Remember to change the password in production!")
    else:
        print("❌ Failed to create admin user")

if __name__ == "__main__":
    asyncio.run(create_admin_user())