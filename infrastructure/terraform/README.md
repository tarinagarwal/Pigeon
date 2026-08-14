# Terraform – Pigeon Backend on AWS

This directory provisions the backend infrastructure on AWS: EC2 instance, optional Application Load Balancer (ALB), security groups, and IAM role. The EC2 instance is bootstrapped with Docker for running the backend container. Deployment is handled by GitHub Actions (see [AWS_DEPLOYMENT.md](../../docs/AWS_DEPLOYMENT.md)).

## What gets created

| Resource | Description |
|----------|-------------|
| **EC2** | Amazon Linux 2023; Docker installed via user-data. |
| **Security groups** | SSH (22) and app (8000); with ALB, app traffic is ALB → EC2 only. |
| **ALB** (optional) | Application Load Balancer on port 80 (and 443 when HTTPS enabled) → EC2:8000. Free tier: 750 hrs/month + 15 LCUs for 12 months. |
| **Elastic IP** (optional) | One persistent public IP for the backend instance. **Not required** if you use the ALB for traffic; set `enable_elastic_ip = false` to skip. This Terraform creates only one EIP; any other Elastic IPs in the account are from other sources—release unused ones in EC2 → Elastic IPs. |
| **IAM** | Instance profile for the EC2 (e.g. SSM); extend for S3/Secrets Manager if needed. |

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) >= 1.0
- [AWS CLI](https://aws.amazon.com/cli/) configured (`aws configure`)
- **EC2 key pair** (optional): leave `key_name` empty to rely on **SSM Session Manager** only. For GitHub Actions SSH deploys, create a key in EC2 → Key Pairs, set `key_name` to its name, and add the `.pem` to GitHub Secrets.

## Setup

1. **Copy the example tfvars:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```
   Edit `terraform.tfvars`. Set `key_name` to your EC2 key pair name if you need SSH with a key; leave it `""` for SSM-only access.

2. **Optional:** Change region, `instance_type`, `enable_alb`, etc. in `terraform.tfvars`.

## Enabling HTTPS (ALB + ACM certificate)

Use the **Application Load Balancer** with an **ACM certificate** for HTTPS. Traffic: Internet → ALB:443 (HTTPS) → EC2:8000.

1. **Get an ACM certificate** (same region as the ALB, e.g. `us-east-1`):
   - **Option A:** AWS Console → **Certificate Manager** → Request a public certificate → add your domain (e.g. `api.pigeon.com`) → validate via DNS.
   - **Option B:** If you use **ACM Private CA**, issue a certificate from your Private CA, then **import** that certificate into ACM (Certificate Manager → Import). The ALB needs an **ACM certificate ARN** (`arn:aws:acm:region:account:certificate/id`), not the Private CA ARN.

2. **Point your domain to the ALB:** In your DNS provider, add a **CNAME**: name = your API subdomain (e.g. `api-pigeon`), value = ALB DNS name from `terraform output alb_dns_name`.

3. **Set in `terraform.tfvars`:**
   ```hcl
   enable_https         = true
   acm_certificate_arn  = "arn:aws:acm:us-east-1:YOUR_ACCOUNT:certificate/YOUR_CERT_ID"
   domain_name          = "api.pigeon.com"
   ```

4. **Apply:** `terraform apply`. The ALB gets an HTTPS listener on 443 and HTTP (80) redirects to HTTPS.

5. **Use the HTTPS URL** in frontend/admin: `NEXT_PUBLIC_API_URL=https://api.pigeon.com/api`, `VITE_API_URL=https://api.pigeon.com/api`.

## Tracking domain setup (Phase 1)

Use a separate host for tracking links/pixels (recommended: `track.pigeon.com`).

1. Add DNS:
   - `track.pigeon.com` CNAME -> `api.pigeon.com` (or directly to ALB DNS).
2. Ensure your ACM cert includes `track.pigeon.com` (or wildcard `*.pigeon.com`).
3. Set backend env:
   - `TRACKING_BASE_URL=https://track.pigeon.com`
4. Optional custom-domain verification target:
   - `TRACKING_CNAME_TARGET=track.pigeon.com`

## Troubleshooting: https://api.pigeon.com/ not loading

If the custom domain does not load, check these in order:

### 1. DNS (CNAME)

- **CNAME record:** Hostinger (or your DNS) must have:
  - **Name/host:** `api-pigeon` (so full name is `api.pigeon.com`)
  - **Target/value:** `pigeon-backend-production-alb-1093121194.us-east-1.elb.amazonaws.com`  
    **No** `https://` or trailing `/` in the target.
- **Check resolution:**
  ```bash
  dig api.pigeon.com CNAME +short
  # or: nslookup api.pigeon.com
  ```
  You should see the ALB hostname. If not, fix the CNAME and wait for DNS propagation (up to 48h, often minutes).

### 2. ACM certificate

- The ALB HTTPS listener uses the cert in `acm_certificate_arn`. That cert must **include** your API hostname (e.g. `api.yourdomain.com`, or a wildcard `*.yourdomain.com`).
- **Check:** AWS Console → **Certificate Manager** (us-east-1) → open the certificate used in `terraform.tfvars` → under "Domain name" you should see that hostname, and status **Issued**.
- If the cert is for a different name, request a new cert for `api.pigeon.com`, validate via DNS, then set `acm_certificate_arn` in `terraform.tfvars` and run `terraform apply`.

### 3. ALB target group (backend healthy)

- The ALB health check uses path `/api/health`. If the target is **unhealthy**, the ALB returns 503 and the site will not load.
- **Check:** AWS Console → **EC2** → **Target Groups** → select the backend target group → **Targets** tab. Status should be **Healthy**.
- If **Unhealthy:** ensure the backend container is running on the EC2 instance (e.g. re-run the deploy workflow), and that the instance can reach MongoDB if your health check depends on it.

### 4. Quick tests

- **HTTP (should redirect to HTTPS):**  
  `curl -I http://api.pigeon.com`  
  Expect `301` or `302` to `https://...`.
- **HTTPS:**  
  `curl -I https://api.pigeon.com/api/health`  
  Expect `200` if backend and cert are OK. If you see SSL/certificate errors, fix the ACM cert (step 2). If you see connection refused or timeout, check DNS (step 1) and security groups (ALB allows 443 from 0.0.0.0/0).

## Troubleshooting: Backend container not running on new instance

If a new EC2 instance has no `pigeon-backend` container (`docker logs pigeon-backend` → "No such container"):

1. **Check bootstrap log:** `sudo cat /var/log/user-data.log` — look for ECR pull failures, missing `.env`, or permission errors.
2. **Run deploy manually once:** `sudo /usr/local/bin/ecr-auto-deploy.sh` — pulls the image and starts the container.
3. **Periodic retry:** A timer runs every 5 minutes and starts the container if it is missing. Wait a few minutes or run the script above.
4. **Ensure ECR has the image:** Push from main (or run the deploy workflow) so `pigeon-backend:latest` exists in ECR; the instance role must have permission to pull from ECR.

## Commands

From this directory (`infrastructure/terraform/`):

| Command | Description |
|---------|-------------|
| `terraform init` | Download providers and init backend (run once or after adding providers). |
| `terraform plan` | Show what would change. |
| `terraform apply` | Create or update infrastructure. Use `-auto-approve` to skip confirmation. |
| `terraform output` | Print outputs (IP, ALB URL, SSH command). |
| `terraform destroy` | Tear down all resources. |
| `terraform fmt` | Format `.tf` files. |
| `terraform validate` | Check configuration. |

**Typical flow:**
```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
terraform output
```

## Variables (summary)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `key_name` | No | `""` | EC2 key pair name for SSH; empty omits a key (use SSM Session Manager). |
| `excluded_availability_zones` | No | `["us-east-1e"]` | Subnets in these AZs are not used for ALB/ASG (e.g. some instance types are unavailable in `us-east-1e`). |
| `aws_region` | No | `us-east-1` | AWS region. |
| `environment` | No | `production` | Environment label. |
| `project_name` | No | `pigeon-backend` | Prefix for resource names. |
| `instance_type` | No | `t3.small` | EC2 type. Use `t3.micro` for free tier. |
| `app_port` | No | `8000` | Port the backend listens on. |
| `enable_alb` | No | `true` | Create ALB in front of EC2. |
| `alb_listener_port` | No | `80` | ALB listener port. |
| `alb_health_check_path` | No | `/api/health` | Health check path. |
| `enable_https` | No | `false` | Add HTTPS (443) on ALB and redirect HTTP → HTTPS. Requires `acm_certificate_arn`. |
| `acm_certificate_arn` | No | `""` | ACM certificate ARN (`arn:aws:acm:...`). Required when `enable_https = true`. If using Private CA, issue a cert and import into ACM. |
| `domain_name` | No | `""` | Custom domain (e.g. `api.pigeon.com`) for `app_url` output. Point CNAME to ALB. |
| `ssh_allowed_cidrs` | No | `["0.0.0.0/0"]` | CIDRs allowed to SSH (restrict in production). |
| `enable_public_ip` | No | `true` | Give EC2 a public IP (needed for GitHub Actions SSH). |

See `variables.tf` for the full list.

## Outputs

After `terraform apply`:

- **`app_url`** – Backend base URL (HTTPS when `enable_https` is set, else HTTP via ALB). Use in frontend/admin env vars.
- **`alb_dns_name`** – ALB hostname when `enable_alb = true`.
- **`backend_public_ip`** – EC2 public IP (for SSH and GitHub Secret `EC2_HOST`).
- **`backend_public_dns`** – EC2 public DNS.
- **`backend_ssh_command`** – Example SSH command (replace `<path-to-your-key.pem>`).
- **`instance_id`** – EC2 instance ID.

## GitHub Actions

Deploys use SSH to this EC2 instance. In the repo’s GitHub Secrets set:

- **EC2_HOST** – `backend_public_ip` (or `backend_public_dns`)
- **EC2_SSH_KEY** – Full contents of your `.pem` file
- **EC2_USER** – `ec2-user`

See [docs/AWS_DEPLOYMENT.md](../../docs/AWS_DEPLOYMENT.md) for full CI/CD and secret setup.

## Security groups (summary)

| Group | Ingress | Egress |
|-------|---------|--------|
| **Backend EC2** | SSH (22) from `ssh_allowed_cidrs`. App (8000) from ALB SG when ALB enabled, else from `app_allowed_cidrs`. | All (Docker, MongoDB, APIs, packages). |
| **ALB** | HTTP (80) and, when HTTPS enabled, HTTPS (443) from internet (`0.0.0.0/0`). | VPC CIDR only (targets and health checks). |

With ALB enabled (default), the backend is **not** reachable on port 8000 from the internet—only the ALB can talk to it. Restrict SSH in production by setting `ssh_allowed_cidrs` in `terraform.tfvars` (e.g. your IP or GitHub Actions IP range).

## Cost notes

- **EC2:** `t3.micro` is in the 12‑month free tier (750 hrs/month). `t3.small` is not free (~$15/month).
- **ALB:** Free tier 750 hrs/month + 15 LCUs for 12 months; then paid.

## Remote state (optional)

For production, store state in S3 with locking:

1. Create an S3 bucket and DynamoDB table for locks.
2. Uncomment and fill the `backend "s3"` block in `main.tf`.
3. Run `terraform init -migrate-state` to move local state to S3.
