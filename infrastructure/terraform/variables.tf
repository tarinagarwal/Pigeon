variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g. staging, production)"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "pigeon-backend"
}

variable "instance_type" {
  description = "EC2 instance type for the backend server"
  type        = string
  default     = "t3.small"
}

variable "app_port" {
  description = "Port the backend application listens on"
  type        = number
  default     = 8000
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed to SSH (e.g. GitHub Actions IPs or your IP)"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Restrict in production (e.g. use GitHub's IP range or VPN)
}

variable "app_allowed_cidrs" {
  description = "CIDR blocks allowed to access the app port (0.0.0.0/0 for public API)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "key_name" {
  description = "Optional EC2 key pair name for SSH. Leave empty to omit (use SSM Session Manager). If set, the key must exist in this region."
  type        = string
  default     = ""
}

# Some instance types are not offered in every AZ (e.g. t3 in us-east-1e). Subnets in these AZs are skipped for ALB + ASG.
variable "excluded_availability_zones" {
  description = "Availability zones to omit when choosing subnets for the ALB and ASG (subnet IDs from the default VPC in these AZs are excluded)"
  type        = list(string)
  default     = ["us-east-1e"]
}

variable "enable_public_ip" {
  description = "Assign a public IP to the EC2 instance (required for GitHub Actions SSH from internet)"
  type        = bool
  default     = true
}

# Elastic IP: one fixed public IP for the backend instance (e.g. for allowlists or direct access).
# Traffic normally goes via ALB; EIP is optional. Only ONE EIP is created by this Terraform.
# Extra Elastic IPs in the AWS account are from other sources (manual, old stacks)—release unused ones in the console.
variable "enable_elastic_ip" {
  description = "Allocate and attach a persistent Elastic IP to the backend instance (not required if you use ALB only)"
  type        = bool
  default     = true
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GB (Amazon Linux 2023 AMI requires >= 30)"
  type        = number
  default     = 30
}

# Application Load Balancer (free tier: 750 hrs/month + 15 LCUs for 12 months)
variable "enable_alb" {
  description = "Create an Application Load Balancer in front of the backend (traffic via ALB only)"
  type        = bool
  default     = true
}

variable "alb_listener_port" {
  description = "ALB listener port (HTTP)"
  type        = number
  default     = 80
}

variable "alb_health_check_path" {
  description = "Health check path for ALB target group"
  type        = string
  default     = "/api/health"
}

# HTTPS on ALB (ACM certificate). ALB terminates SSL; HTTP redirects to HTTPS.
variable "enable_https" {
  description = "Add HTTPS listener (443) on the ALB and redirect HTTP to HTTPS. Requires acm_certificate_arn and domain pointing to the ALB."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate (arn:aws:acm:region:account:certificate/id). Required when enable_https = true. If you use ACM Private CA, issue a cert from it and import into ACM, then use that ACM cert ARN here."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Custom domain for the API (e.g. api.pigeon.com). Used for app_url output. Point CNAME to the ALB DNS name (terraform output alb_dns_name)."
  type        = string
  default     = ""
}

# Auto Scaling Group Configuration
variable "asg_min_size" {
  description = "Minimum number of instances in the ASG"
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "Maximum number of instances in the ASG"
  type        = number
  default     = 10
}

variable "asg_desired_capacity" {
  description = "Desired number of instances in the ASG"
  type        = number
  default     = 1
}
