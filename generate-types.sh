#!/usr/bin/env bash
# Generate shared types from the OpenAPI spec.
# ONLY edit openapi.yaml — never edit the files in shared/

set -euo pipefail
cd "$(dirname "$0")"

echo "Generating Python types..."
datamodel-codegen \
  --input openapi.yaml \
  --output shared/python/models.py \
  --input-file-type openapi \
  --output-model-type pydantic_v2.BaseModel

echo "Generating TypeScript types..."
npx --yes openapi-typescript openapi.yaml -o shared/typescript/api.ts

echo ""
echo "Done. Types regenerated from openapi.yaml"
echo "DO NOT edit the files in shared/ — they will be overwritten."
