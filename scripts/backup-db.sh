#!/bin/bash
# =============================================================================
# PostgreSQL Backup Script — ios-screen-time-screenshot-processing
# =============================================================================
# Dumps the database from the Docker container and stores backups on the HOST
# filesystem (completely outside Docker volumes). Survives docker-compose down -v,
# volume prunes, and any other Docker nonsense.
#
# Usage:
#   ./scripts/backup-db.sh              # Full backup (DB + uploads)
#   ./scripts/backup-db.sh --db-only    # Database only
#   ./scripts/backup-db.sh --dry-run    # Show what would happen
#
# Restoring:
#   ./scripts/restore-db.sh /home/uzair/backups/ios-screen-time/db/<file>.dump
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
BACKUP_ROOT="/home/uzair/backups/ios-screen-time"
DB_BACKUP_DIR="$BACKUP_ROOT/db"
UPLOADS_BACKUP_DIR="$BACKUP_ROOT/uploads"
LOG_DIR="$BACKUP_ROOT/logs"
LOG_FILE="$LOG_DIR/backup.log"

CONTAINER_NAME="ios-screen-time-screenshot-processing-postgres"

# Auto-detect credentials from the running container (Dokploy may override .env values)
DB_USER=$(docker exec "$CONTAINER_NAME" bash -c 'echo $POSTGRES_USER' 2>/dev/null || echo "screenshot")
DB_NAME=$(docker exec "$CONTAINER_NAME" bash -c 'echo $POSTGRES_DB' 2>/dev/null || echo "screenshot_annotations")

RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

DB_ONLY=false
DRY_RUN=false

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------
for arg in "$@"; do
    case $arg in
        --db-only)   DB_ONLY=true ;;
        --dry-run)   DRY_RUN=true ;;
        -h|--help)
            head -16 "$0" | tail -14
            exit 0
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

die() {
    log "FATAL: $1"
    exit 1
}

# Ensure backup directories exist
mkdir -p "$DB_BACKUP_DIR" "$UPLOADS_BACKUP_DIR" "$LOG_DIR"

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
log "=== Backup starting ==="

# Verify the postgres container is running
if ! docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null | grep -q running; then
    die "Container '$CONTAINER_NAME' is not running. Cannot backup."
fi

# Verify we can connect to the database
if ! docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; then
    die "PostgreSQL is not accepting connections inside '$CONTAINER_NAME'."
fi

if $DRY_RUN; then
    log "[DRY RUN] Would create: $DB_BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"
    log "[DRY RUN] Would create: $DB_BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
    if ! $DB_ONLY; then
        log "[DRY RUN] Would rsync uploads to: $UPLOADS_BACKUP_DIR/"
    fi
    log "[DRY RUN] Would delete backups older than $RETENTION_DAYS days"
    exit 0
fi

# -----------------------------------------------------------------------------
# 1. Database backup — custom format (fast restore, compressed)
# -----------------------------------------------------------------------------
DUMP_FILE="$DB_BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"
log "Dumping database (custom format) → $DUMP_FILE"

docker exec "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
    > "$DUMP_FILE" \
    || die "pg_dump (custom format) failed"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
log "Custom dump complete: $DUMP_SIZE"

# -----------------------------------------------------------------------------
# 2. Database backup — SQL (portable, human-readable)
# -----------------------------------------------------------------------------
SQL_GZ_FILE="$DB_BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
log "Dumping database (SQL + gzip) → $SQL_GZ_FILE"

docker exec "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain \
    | gzip -9 \
    > "$SQL_GZ_FILE" \
    || die "pg_dump (SQL format) failed"

SQL_GZ_SIZE=$(du -h "$SQL_GZ_FILE" | cut -f1)
log "SQL dump complete: $SQL_GZ_SIZE"

# -----------------------------------------------------------------------------
# 3. Backup uploaded files (rsync from Docker volume to host)
# -----------------------------------------------------------------------------
if ! $DB_ONLY; then
    # Get the volume mountpoint on the host
    UPLOADS_VOLUME="ios-screen-time-screenshot-processing_uploads_data"
    VOLUME_PATH=$(docker volume inspect "$UPLOADS_VOLUME" --format '{{.Mountpoint}}' 2>/dev/null || true)

    if [ -n "$VOLUME_PATH" ]; then
        # Docker data dir may need root — try via container instead
        UPLOAD_COUNT=$(docker exec "$CONTAINER_NAME" sh -c 'ls /var/lib/postgresql/ 2>/dev/null | wc -l' || echo 0)

        # Use the backend container which has the uploads mounted
        BACKEND_CONTAINER="ios-screen-time-screenshot-processing-backend"
        if docker inspect --format='{{.State.Status}}' "$BACKEND_CONTAINER" 2>/dev/null | grep -q running; then
            log "Syncing uploaded files → $UPLOADS_BACKUP_DIR/"
            # tar from inside the container, extract on host
            docker exec "$BACKEND_CONTAINER" \
                tar cf - -C /app/uploads . 2>/dev/null \
                | tar xf - -C "$UPLOADS_BACKUP_DIR/" 2>/dev/null \
                || log "WARNING: Upload file backup had issues (directory may be empty)"

            UPLOAD_FILE_COUNT=$(find "$UPLOADS_BACKUP_DIR" -type f 2>/dev/null | wc -l)
            log "Upload backup complete: $UPLOAD_FILE_COUNT files"
        else
            log "WARNING: Backend container not running, skipping upload file backup"
        fi
    else
        log "WARNING: Uploads volume not found, skipping upload file backup"
    fi
fi

# -----------------------------------------------------------------------------
# 4. Retention — delete backups older than $RETENTION_DAYS days
# -----------------------------------------------------------------------------
log "Cleaning backups older than $RETENTION_DAYS days..."

DELETED_DUMPS=$(find "$DB_BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete -print | wc -l)
DELETED_SQLS=$(find "$DB_BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)

log "Cleaned up: $DELETED_DUMPS .dump files, $DELETED_SQLS .sql.gz files"

# -----------------------------------------------------------------------------
# 5. Summary
# -----------------------------------------------------------------------------
TOTAL_BACKUPS=$(find "$DB_BACKUP_DIR" -name "*.dump" | wc -l)
TOTAL_SIZE=$(du -sh "$DB_BACKUP_DIR" | cut -f1)

log "=== Backup complete ==="
log "  Database dumps: $TOTAL_BACKUPS backups, $TOTAL_SIZE total"
log "  Retention: $RETENTION_DAYS days"
log "  Latest: $DUMP_FILE"
