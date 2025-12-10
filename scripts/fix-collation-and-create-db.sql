-- Complete script to fix collation and create database
-- Run this in psql as postgres superuser

-- Step 1: Refresh template1 collation version
ALTER DATABASE template1 REFRESH COLLATION VERSION;

-- Step 2: Create the database (now it should work)
CREATE DATABASE pos_db;

-- Step 3: Verify it was created
\l pos_db

-- If CREATE DATABASE still fails, use this alternative:
-- CREATE DATABASE pos_db WITH TEMPLATE template0 ENCODING 'UTF8';


