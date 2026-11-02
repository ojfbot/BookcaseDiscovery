#!/usr/bin/env bash
# Label Studio for BookcaseDiscovery labelling (V-1a). See docs/labelling.md.
#
#   scripts/label-studio.sh start                          run the server on 127.0.0.1 only
#   scripts/label-studio.sh project <title> <tasks.json> <images-dir>
#                                                          create a project from docs/labelling-config.xml, import tasks,
#                                                          and allow serving images from <images-dir> (under $BOOKCASE_DATA)
#
# Everything private lives under $BOOKCASE_DATA/labels/: the database, the login, the images' tasks.
# Install once with:  uv tool install --python 3.12 label-studio
set -euo pipefail

DATA="${BOOKCASE_DATA:-$HOME/data/bookcase-discovery}"
LABELS="$DATA/labels"
PORT="${LS_PORT:-8088}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS="$LABELS/ls-credentials.txt"
export PATH="$HOME/.local/bin:$PATH"

make_credentials() {
  mkdir -p "$LABELS/ls-data"
  chmod 700 "$LABELS"
  if [ ! -f "$CREDS" ]; then
    umask 077
    {
      echo "username=labeller@bookcase.test"
      echo "password=$(openssl rand -base64 18 | tr -d '/+=')"
      echo "token=$(openssl rand -hex 20)"
    } > "$CREDS"
    echo "wrote a generated local login to $CREDS (never commit or paste it)" >&2
  fi
}
cred() { sed -n "s/^$1=//p" "$CREDS"; }

case "${1:-}" in
  start)
    make_credentials
    # Defaults in Label Studio 1.23.2 that this overrides (docs/labelling.md has the evidence):
    #   binds 0.0.0.0 -> --internal-host 127.0.0.1;  Sentry error reports (back and front end) -> empty DSNs;
    #   usage analytics -> COLLECT_ANALYTICS=false;  PyPI version check -> LATEST_VERSION_CHECK=false.
    export COLLECT_ANALYTICS=false LATEST_VERSION_CHECK=false SENTRY_DSN= FRONTEND_SENTRY_DSN=
    export LABEL_STUDIO_DISABLE_SIGNUP_WITHOUT_LINK=true LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN=true
    export LOCAL_FILES_SERVING_ENABLED=true LOCAL_FILES_DOCUMENT_ROOT="$DATA"
    export LABEL_STUDIO_USERNAME="$(cred username)" LABEL_STUDIO_PASSWORD="$(cred password)" LABEL_STUDIO_USER_TOKEN="$(cred token)"
    echo "Label Studio on http://127.0.0.1:$PORT  (login: see $CREDS)" >&2
    exec label-studio start --no-browser --internal-host 127.0.0.1 --port "$PORT" --data-dir "$LABELS/ls-data"
    ;;
  project)
    [ $# -eq 4 ] || { echo "usage: $0 project <title> <tasks.json> <images-dir>" >&2; exit 1; }
    imgdir="$(cd "$4" && pwd -P)"
    case "$imgdir/" in "$(cd "$DATA" && pwd -P)"/*) ;; *) echo "images-dir must be under $DATA" >&2; exit 1 ;; esac
    make_credentials
    AUTH="Authorization: Token $(cred token)"
    BASE="http://127.0.0.1:$PORT"
    body="$(node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({title:process.argv[1],label_config:fs.readFileSync(process.argv[2],"utf8")}))' "$2" "$HERE/../docs/labelling-config.xml")"
    id="$(curl -sf -H "$AUTH" -H 'Content-Type: application/json' -d "$body" "$BASE/api/projects" | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).id))')"
    # Label Studio only serves /data/local-files/ for paths under a Local Files storage of the project.
    curl -sf -H "$AUTH" -H 'Content-Type: application/json' -d "{\"project\":$id,\"title\":\"images\",\"path\":\"$imgdir\",\"use_blob_urls\":false}" "$BASE/api/storages/localfiles" >/dev/null
    curl -sf -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$3" "$BASE/api/projects/$id/import" >/dev/null
    echo "project $id: $BASE/projects/$id/data" >&2
    ;;
  *)
    echo "usage: $0 start | project <title> <tasks.json> <images-dir>" >&2
    exit 1
    ;;
esac
