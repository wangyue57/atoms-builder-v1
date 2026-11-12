#!/bin/sh
set -eu
# psql's identifier/literal quoting keeps bootstrap values out of SQL interpolation.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="$APP_DB_USER" --set=app_password="$APP_DB_PASSWORD" --set=app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER DATABASE :"app_db" OWNER TO :"app_user";
GRANT ALL ON SCHEMA public TO :"app_user";
SQL
