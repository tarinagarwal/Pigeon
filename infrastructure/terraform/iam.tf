# IAM role for the EC2 instance (for future use: S3, Secrets Manager, SSM, etc.)
resource "aws_iam_role" "backend_instance" {
  name = "${var.project_name}-${var.environment}-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# Basic policy: CloudWatch agent and SSM (optional, for debugging without SSH)
resource "aws_iam_role_policy_attachment" "ssm_managed" {
  role       = aws_iam_role.backend_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Allow instances to handle ASG lifecycle hooks (for graceful shutdown)
resource "aws_iam_role_policy" "asg_lifecycle" {
  name = "${var.project_name}-${var.environment}-asg-lifecycle"
  role = aws_iam_role.backend_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "autoscaling:CompleteLifecycleAction",
          "autoscaling:RecordLifecycleActionHeartbeat"
        ]
        Effect   = "Allow"
        Resource = "*"
      },
      {
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeAddresses",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeInstanceRefreshes",
          "autoscaling:DescribeLifecycleHooks"
        ]
        Effect   = "Allow"
        Resource = "*"
      },
      {
        Action = [
          "ec2:AssociateAddress",
          "ec2:DisassociateAddress"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "backend_instance" {
  name = "${var.project_name}-${var.environment}-instance-profile"
  role = aws_iam_role.backend_instance.name
}

# Allow instances to pull Docker images from ECR
resource "aws_iam_role_policy" "ecr_pull" {
  name = "${var.project_name}-${var.environment}-ecr-pull"
  role = aws_iam_role.backend_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Effect   = "Allow"
        Resource = "*"
      },
      {
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Effect   = "Allow"
        Resource = aws_ecr_repository.backend.arn
      }
    ]
  })
}

# Allow instances to read backend env from SSM Parameter Store
resource "aws_iam_role_policy" "ssm_env" {
  name = "${var.project_name}-${var.environment}-ssm-env"
  role = aws_iam_role.backend_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ssm:GetParameter"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

# Optional: extend with custom policy for S3, Secrets Manager, etc.
# resource "aws_iam_role_policy" "backend_custom" {
#   name   = "${var.project_name}-custom"
#   role   = aws_iam_role.backend_instance.id
#   policy = data.aws_iam_policy_document.backend_custom.json
# }
# data "aws_iam_policy_document" "backend_custom" {
#   statement {
#     actions   = ["s3:GetObject", "s3:PutObject"]
#     resources = ["arn:aws:s3:::your-bucket/*"]
#   }
# }
