#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download it from https://nodejs.org (the LTS version), install it, then double-click this file again."
  read -p "Press Enter to close."
  exit 1
fi
(sleep 1; open "http://localhost:3000") &
node server.js
