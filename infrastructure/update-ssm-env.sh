#!/usr/bin/env bash
set -euo pipefail

SSM_PARAM_NAME="/pigeon/backend/env_b64"

# Reads secrets from a local .env file (never hard-code them here) and pushes the
# base64-encoded contents to SSM. Override the source file with ENV_FILE=... if needed.
#   ./update-ssm-env.sh
#   ENV_FILE=../pigeon-backend/.env ./update-ssm-env.sh
ENV_FILE="${ENV_FILE:-../pigeon-backend/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found at '$ENV_FILE'. Set ENV_FILE=/path/to/.env and retry." >&2
  exit 1
fi

# base64-encode the .env with no line wrapping (portable across GNU/BSD base64).
BASE64_VALUE="$(base64 < "$ENV_FILE" | tr -d '\n')"

if [[ -z "$BASE64_VALUE" ]]; then
  echo "ERROR: '$ENV_FILE' is empty; nothing to upload." >&2
  exit 1
fi

echo "=== Current SSM value ==="
CURRENT=$(aws ssm get-parameter --name "$SSM_PARAM_NAME" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || echo "")
if [[ -n "$CURRENT" ]]; then
  echo "$CURRENT"
else
  echo "(parameter empty or not found)"
fi

# Standard tier max is 4096 chars; use Advanced for larger values
VAL_LEN=${#BASE64_VALUE}
if [[ "$VAL_LEN" -gt 4096 ]]; then
  echo "Value length $VAL_LEN > 4096, using Advanced tier."
  aws ssm put-parameter \
    --name "$SSM_PARAM_NAME" \
    --value "$BASE64_VALUE" \
    --type SecureString \
    --tier Advanced \
    --overwrite
else
  aws ssm put-parameter \
    --name "$SSM_PARAM_NAME" \
    --value "$BASE64_VALUE" \
    --type SecureString \
    --overwrite
fi

echo ""
echo "=== Updated SSM value ==="
UPDATED=$(aws ssm get-parameter --name "$SSM_PARAM_NAME" --with-decryption --query 'Parameter.Value' --output text)
echo "$UPDATED"
