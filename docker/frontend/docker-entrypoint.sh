#!/bin/sh
# Generate runtime config from environment variables
cat > /usr/share/nginx/html/config.js << JSEOF
window.__CONFIG__ = {
  basePath: "${BASE_PATH:-}",
};
JSEOF

# Inject base href if BASE_PATH is set (idempotent - skip if already present)
if [ -n "$BASE_PATH" ]; then
    if ! grep -q '<base href=' /usr/share/nginx/html/index.html; then
        sed -i "s|<head>|<head><base href=\"${BASE_PATH}/\">|" /usr/share/nginx/html/index.html
    fi
fi

# Start nginx
exec nginx -g "daemon off;"
