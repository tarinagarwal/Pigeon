#!/usr/bin/env bash
set -euo pipefail

# Usage: ./script.sh <LIFECYCLE_HOOK_NAME> <ASG_NAME>
LIFECYCLE_HOOK_NAME="pigeon-backend-production-termination-hook"
ASG_NAME="pigeon-backend-production-asg"

if [[ -z "$LIFECYCLE_HOOK_NAME" || -z "$ASG_NAME" ]]; then
  echo "Usage: $0 <LIFECYCLE_HOOK_NAME> <ASG_NAME>"
  exit 1
fi

# Get all instance IDs in Terminating:Wait for the given ASG
INSTANCE_IDS=$(aws autoscaling describe-auto-scaling-instances \
  --query "AutoScalingInstances[?LifecycleState=='Terminating:Wait' && AutoScalingGroupName=='${ASG_NAME}'].InstanceId" \
  --output text)

if [[ -z "$INSTANCE_IDS" ]]; then
  echo "No instances found in Terminating:Wait for ASG: $ASG_NAME"
  exit 0
fi

for INSTANCE_ID in $INSTANCE_IDS; do
  echo "Completing lifecycle action for $INSTANCE_ID"
  aws autoscaling complete-lifecycle-action \
    --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME" \
    --auto-scaling-group-name "$ASG_NAME" \
    --instance-id "$INSTANCE_ID" \
    --lifecycle-action-result CONTINUE
done