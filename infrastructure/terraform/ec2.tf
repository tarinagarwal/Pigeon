# Security group for backend EC2 instance.
# - SSH (22): from ssh_allowed_cidrs only (restrict in production).
# - App (8000): from ALB SG when ALB enabled (no direct internet); else from app_allowed_cidrs.
# - Egress: all (needed for Docker, MongoDB, package repos, APIs).
resource "aws_security_group" "backend" {
  name        = "${var.project_name}-${var.environment}-sg"
  description = "Security group for backend EC2 instance"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH (for GitHub Actions deploy and admin)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
  }

  # App port: only from ALB when ALB enabled (backend not exposed to internet)
  dynamic "ingress" {
    for_each = var.enable_alb ? [] : [1]
    content {
      description = "Backend API (direct)"
      from_port   = var.app_port
      to_port     = var.app_port
      protocol    = "tcp"
      cidr_blocks = var.app_allowed_cidrs
    }
  }
  dynamic "ingress" {
    for_each = var.enable_alb ? [1] : []
    content {
      description     = "Backend API (from ALB)"
      from_port       = var.app_port
      to_port         = var.app_port
      protocol        = "tcp"
      security_groups = [aws_security_group.alb[0].id]
    }
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-sg"
  }
}

# Use default VPC and subnets for simplicity; override with data sources if using custom VPC
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_subnet" "default_vpc" {
  for_each = toset(data.aws_subnets.default.ids)
  id       = each.value
}

locals {
  subnet_ids_for_lb_and_asg = [
    for id, sub in data.aws_subnet.default_vpc : id
    if !contains(var.excluded_availability_zones, sub.availability_zone)
  ]
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# User data: bootstrap Docker (runs as root on first boot)
locals {
  bootstrap_script = file("${path.module}/bootstrap/docker-bootstrap.sh")
}

# Migrate existing state: EIP and SSM param were previously without count.
moved {
  from = aws_eip.backend
  to   = aws_eip.backend[0]
}
moved {
  from = aws_ssm_parameter.eip_allocation_id
  to   = aws_ssm_parameter.eip_allocation_id[0]
}

# Persistent Elastic IP (optional). When enabled, one EIP is created and associated to the
# current ASG instance by the bootstrap script. Traffic can go via ALB only—EIP is not required.
resource "aws_eip" "backend" {
  count  = var.enable_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.environment}-eip"
  }
}

# SSM parameter so instances can associate the EIP on boot (ASG instances read this in user data)
resource "aws_ssm_parameter" "eip_allocation_id" {
  count       = var.enable_elastic_ip ? 1 : 0
  name        = "/pigeon/backend/eip_allocation_id"
  description = "Elastic IP allocation ID for backend ASG instance"
  type        = "String"
  value       = aws_eip.backend[0].allocation_id
  tags = {
    Name = "${var.project_name}-${var.environment}-eip-param"
  }
}

# Launch Template for ASG
resource "aws_launch_template" "backend" {
  name_prefix   = "${var.project_name}-${var.environment}-lt-"
  image_id      = data.aws_ami.amazon_linux_2023.id
  instance_type = var.instance_type
  key_name      = var.key_name != "" ? var.key_name : null

  network_interfaces {
    associate_public_ip_address = var.enable_public_ip
    security_groups             = [aws_security_group.backend.id]
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.backend_instance.name
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = var.root_volume_size_gb
      volume_type = "gp3"
    }
  }

  user_data = base64encode(local.bootstrap_script)

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-${var.environment}"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "backend" {
  name                = "${var.project_name}-${var.environment}-asg"
  vpc_zone_identifier = local.subnet_ids_for_lb_and_asg
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity

  launch_template {
    id      = aws_launch_template.backend.id
    version = "$Latest"
  }

  target_group_arns = var.enable_alb ? [aws_lb_target_group.backend[0].arn] : []

  tag {
    key                 = "Name"
    value               = "${var.project_name}-${var.environment}"
    propagate_at_launch = true
  }
}

# Lifecycle Hook for graceful termination
resource "aws_autoscaling_lifecycle_hook" "graceful_termination" {
  name                   = "${var.project_name}-${var.environment}-termination-hook"
  autoscaling_group_name = aws_autoscaling_group.backend.name
  default_result         = "CONTINUE"
  heartbeat_timeout      = 3600 # Wait up to 1 hour (extendable via heartbeats)
  lifecycle_transition   = "autoscaling:EC2_INSTANCE_TERMINATING"
}
