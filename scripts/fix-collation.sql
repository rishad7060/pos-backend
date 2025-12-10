-- Fix PostgreSQL Collation Version Mismatch
-- Run these commands in psql as superuser (postgres)

-- Option 1: Refresh template1 collation version
ALTER DATABASE template1 REFRESH COLLATION VERSION;

-- Option 2: Create database using template0 instead (alternative)
-- CREATE DATABASE pos_db WITH TEMPLATE template0;

-- Option 3: If Option 1 fails, try updating all template databases
-- ALTER DATABASE template0 REFRESH COLLATION VERSION;
-- ALTER DATABASE template1 REFRESH COLLATION VERSION;


