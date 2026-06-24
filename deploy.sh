#!/bin/bash
# Usage: ./deploy.sh "your deployment message"
set -e

if [ -z "$1" ]; then
  echo "Usage: ./deploy.sh \"your deployment message\""
  exit 1
fi

cd "$(dirname "$0")"

git add -A
git commit -m "$1"
vercel --prod
