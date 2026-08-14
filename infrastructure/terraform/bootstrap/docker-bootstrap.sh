#!/bin/bash
# Bootstrap script for EC2: install Docker and runtime dependencies.
# Used by Terraform user_data. Runs once on first boot.
set -e
exec > >(tee /var/log/user-data.log) 2>&1

echo "==> Updating system packages"
dnf update -y

# Ensure SSM agent is running so instance registers with Systems Manager (required for SSM SendCommand deploy)
echo "==> Enabling and starting SSM agent (for SSM Managed Instances / in-place deploy)"
systemctl enable amazon-ssm-agent 2>/dev/null || true
systemctl start amazon-ssm-agent 2>/dev/null || true

echo "==> Installing Docker and rsync (for GitHub Actions deploy)"
dnf install -y docker rsync jq
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

echo "==> Installing Docker Compose v2 (plugin)"
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/bin/docker-compose

echo "==> Creating app directory for deployments"
mkdir -p /home/ec2-user/app/backend
chown -R ec2-user:ec2-user /home/ec2-user/app

echo "==> Creating signals directory for ASG drain (backend reads /signals in container)"
mkdir -p /opt/pigeon/signals
chmod 755 /opt/pigeon/signals

echo "==> Fetching backend env from SSM (if configured)"
ENV_FILE="/home/ec2-user/app/.env"
SSM_PARAM_NAME="/pigeon/backend/env_b64"

if aws ssm get-parameter --name "$SSM_PARAM_NAME" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null | base64 -d > "$ENV_FILE"; then
  chown ec2-user:ec2-user "$ENV_FILE"
  echo "==> Wrote env file to $ENV_FILE from SSM parameter $SSM_PARAM_NAME"
else
  echo "==> WARNING: Could not fetch SSM parameter $SSM_PARAM_NAME. Container may start without env vars."
fi

echo "==> Creating ECR Auto-Deploy script"
cat <<'DEPLOY_EOF' > /usr/local/bin/ecr-auto-deploy.sh
#!/bin/bash
# Script to pull latest image from ECR and start the container
set -e

# Resolve region: IMDSv2 (required in some VPCs) -> IMDSv1 -> env/default
REGION=""
if TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" -m 2 2>/dev/null) && [ -n "$TOKEN" ]; then
  REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" -m 2 "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null)
fi
[ -z "$REGION" ] && REGION=$(curl -s -m 2 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null)
[ -z "$REGION" ] && REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="pigeon-backend"
IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:latest"
CONTAINER_NAME="pigeon-backend"
APP_PORT="8000"
ENV_FILE="/home/ec2-user/app/.env"

echo "[$(date)] Starting ECR auto-deploy..."
echo "Region: $REGION"
echo "Image: $IMAGE_URI"

# Login to ECR
echo "[$(date)] Logging into ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Pull latest image (exit 1 on failure so bootstrap retry loop can retry)
echo "[$(date)] Pulling latest image..."
docker pull $IMAGE_URI || {
    echo "[$(date)] Failed to pull image. Image may not exist yet."
    exit 1
}

# Stop existing container if running
echo "[$(date)] Stopping existing container (if any)..."
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

# Start new container (mount /opt/pigeon/signals so backend can see instance-terminating flag)
SIGNALS_DIR="/opt/pigeon/signals"
mkdir -p "$SIGNALS_DIR"
echo "[$(date)] Starting new container..."
if [ -f "$ENV_FILE" ]; then
    docker run -d \
        --name $CONTAINER_NAME \
        -p $APP_PORT:8000 \
        -v "$SIGNALS_DIR:/signals" \
        --restart unless-stopped \
        --env-file $ENV_FILE \
        $IMAGE_URI
else
    echo "[$(date)] WARNING: $ENV_FILE not found. Container may fail without env vars."
    docker run -d \
        --name $CONTAINER_NAME \
        -p $APP_PORT:8000 \
        -v "$SIGNALS_DIR:/signals" \
        --restart unless-stopped \
        $IMAGE_URI
fi

echo "[$(date)] ECR auto-deploy complete. Container: $CONTAINER_NAME"
DEPLOY_EOF

chmod +x /usr/local/bin/ecr-auto-deploy.sh

echo "==> Running ECR auto-deploy on first boot (with retries)"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if /usr/local/bin/ecr-auto-deploy.sh && docker ps --format '{{.Names}}' | grep -qx "pigeon-backend"; then
    echo "==> Container started on attempt $attempt"
    break
  fi
  echo "==> Attempt $attempt failed or container not running, retrying in 30s..."
  sleep 30
done

echo "==> Associating Elastic IP to this instance (if configured)"
EIP_PARAM="/pigeon/backend/eip_allocation_id"
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
if ALLOC_ID=$(aws ssm get-parameter --name "$EIP_PARAM" --query 'Parameter.Value' --output text 2>/dev/null) && [ -n "$ALLOC_ID" ]; then
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" --region "$REGION" && \
    echo "==> Elastic IP associated" || echo "==> WARNING: EIP association failed (may already be in use)"
else
  echo "==> No EIP allocation ID in SSM ($EIP_PARAM), skipping"
fi

echo "==> Creating delayed ECR deploy service (runs once 2 min after boot)"
cat <<'DELAYED_EOF' > /usr/local/bin/ecr-delayed-deploy.sh
#!/bin/bash
# One-time delayed deploy in case first boot ran before ECR image was ready
sleep 120
/usr/local/bin/ecr-auto-deploy.sh || true
DELAYED_EOF
chmod +x /usr/local/bin/ecr-delayed-deploy.sh
cat <<'SVC_EOF' > /etc/systemd/system/ecr-delayed-deploy.service
[Unit]
Description=Delayed ECR deploy (one-shot)
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ecr-delayed-deploy.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SVC_EOF
systemctl daemon-reload
systemctl enable ecr-delayed-deploy
systemctl start ecr-delayed-deploy

echo "==> Creating periodic ECR ensure-running (fixes new instances where bootstrap failed)"
cat <<'ENSURE_EOF' > /usr/local/bin/ecr-ensure-container.sh
#!/bin/bash
# If backend container is not running, try to start it (pull + run).
# Used by ecr-ensure-container.service; runs every 5 min so new instances eventually get the container.
CONTAINER_NAME="pigeon-backend"
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  exit 0
fi
echo "[$(date)] Container $CONTAINER_NAME not running, attempting ecr-auto-deploy..."
/usr/local/bin/ecr-auto-deploy.sh || true
ENSURE_EOF
chmod +x /usr/local/bin/ecr-ensure-container.sh
cat <<'ENSURE_SVC' > /etc/systemd/system/ecr-ensure-container.service
[Unit]
Description=Ensure pigeon-backend container is running (periodic retry)
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ecr-ensure-container.sh

[Install]
WantedBy=multi-user.target
ENSURE_SVC
cat <<'ENSURE_TIMER' > /etc/systemd/system/ecr-ensure-container.timer
[Unit]
Description=Run ecr-ensure-container every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=1min

[Install]
WantedBy=timers.target
ENSURE_TIMER
systemctl daemon-reload
systemctl enable ecr-ensure-container.timer
systemctl start ecr-ensure-container.timer
echo "==> Timer ecr-ensure-container.timer enabled (runs every 5 min if container missing)"

echo "==> Creating ASG Termination Handler script"
cat <<'EOF' > /usr/local/bin/asg-termination-handler.sh
#!/bin/bash
# Script to wait for background jobs to finish before allowing ASG termination.

INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
ASG_NAME=$(aws autoscaling describe-auto-scaling-instances --instance-ids $INSTANCE_ID --region $REGION --query 'AutoScalingInstances[0].AutoScalingGroupName' --output text)

if [ "$ASG_NAME" == "None" ] || [ -z "$ASG_NAME" ]; then
    echo "Not part of an ASG, exiting."
    exit 0
fi

check_active_jobs() {
    # Check if backend API reports any active campaigns/jobs
    # Returns 0 if jobs are active, 1 if all clear
    
    BACKEND_URL="http://localhost:8000"
    
    # Check if container is even running
    if ! docker ps | grep -q "pigeon-backend"; then
        echo "Backend container not running"
        return 1
    fi
    
    # Query backend for active jobs
    # Note: /api/jobs is the health jobs endpoint
    RESPONSE=$(curl -s -f "$BACKEND_URL/api/jobs" 2>/dev/null || echo "error")
    
    if [ "$RESPONSE" == "error" ]; then
        echo "Cannot reach backend, checking container status only"
        # If we can't talk to the app, we check if docker containers are running
        RUNNING_CONTAINERS=$(docker ps -q)
        if [ -z "$RUNNING_CONTAINERS" ]; then
            return 1 # Safe to stop
        else
            return 0 # Stay alive
        fi
    fi
    
    # Parse JSON response for safe_to_terminate
    SAFE=$(echo "$RESPONSE" | jq -r '.safe_to_terminate // false')
    
    if [ "$SAFE" == "true" ]; then
        echo "No active jobs reported by backend"
        return 1
    else
        ACTIVE_C=$(echo "$RESPONSE" | jq -r '.active_campaigns // 0')
        ACTIVE_J=$(echo "$RESPONSE" | jq -r '.running_system_jobs // 0')
        echo "Jobs still active: Campaigns=$ACTIVE_C, Jobs=$ACTIVE_J"
        return 0
    fi
}

while true; do
    # Check if this instance is in the Terminating:Wait state
    STATE=$(aws autoscaling describe-auto-scaling-instances --instance-ids $INSTANCE_ID --region $REGION --query 'AutoScalingInstances[0].LifecycleState' --output text)
    
    if [ "$STATE" == "Terminating:Wait" ]; then
        echo "[$(date)] Instance is terminating. Signaling backend to stop claiming new jobs..."
        mkdir -p /opt/pigeon/signals
        touch /opt/pigeon/signals/instance-terminating
        echo "[$(date)] Checking for active jobs..."
        
        while check_active_jobs; do
            echo "[$(date)] Jobs still running. Sending heartbeat..."
            aws autoscaling record-lifecycle-action-heartbeat \
                --lifecycle-hook-name "${ASG_NAME%-asg}-termination-hook" \
                --auto-scaling-group-name "$ASG_NAME" \
                --instance-id "$INSTANCE_ID" \
                --region "$REGION"
            sleep 30
        done
        
        echo "[$(date)] Disassociating Elastic IP (if any) so next instance can use it."
        ASSOC_ID=$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE_ID" --region "$REGION" --query 'Addresses[0].AssociationId' --output text 2>/dev/null)
        if [ -n "$ASSOC_ID" ] && [ "$ASSOC_ID" != "None" ]; then
            aws ec2 disassociate-address --association-id "$ASSOC_ID" --region "$REGION" && echo "EIP disassociated" || true
        fi
        
        echo "[$(date)] All jobs completed. Completing lifecycle action."
        aws autoscaling complete-lifecycle-action \
            --lifecycle-hook-name "${ASG_NAME%-asg}-termination-hook" \
            --auto-scaling-group-name "$ASG_NAME" \
            --lifecycle-action-result CONTINUE \
            --instance-id "$INSTANCE_ID" \
            --region "$REGION"
        exit 0
    fi
    sleep 10
done
EOF

chmod +x /usr/local/bin/asg-termination-handler.sh

echo "==> Creating ASG Termination Handler service"
cat <<EOF > /etc/systemd/system/asg-termination-handler.service
[Unit]
Description=ASG Termination Handler
After=network.target docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/asg-termination-handler.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable asg-termination-handler
systemctl start asg-termination-handler

echo "==> Bootstrap complete at $(date)"
