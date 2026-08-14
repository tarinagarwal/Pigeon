output "persistent_elastic_ip" {
  description = "The persistent Elastic IP address (null if enable_elastic_ip = false)"
  value       = var.enable_elastic_ip ? aws_eip.backend[0].public_ip : null
}

output "asg_name" {
  description = "Name of the Auto Scaling Group"
  value       = aws_autoscaling_group.backend.name
}

output "backend_ssh_command" {
  description = "Example SSH command to connect (requires finding an instance IP first)"
  value       = "ssh -i <path-to-your-key.pem> ec2-user@<instance-public-ip>"
}

output "app_url" {
  description = "Base URL for the backend API (HTTPS when enable_https is set, else HTTP via ALB)"
  value = var.enable_alb ? (
    var.enable_https && var.acm_certificate_arn != "" ? "https://${var.domain_name != "" ? var.domain_name : aws_lb.backend[0].dns_name}" : "http://${aws_lb.backend[0].dns_name}"
  ) : (var.enable_elastic_ip ? "http://${aws_eip.backend[0].public_ip}:${var.app_port}" : "http://<instance-public-ip>:${var.app_port} (no EIP)")
}

output "alb_dns_name" {
  description = "ALB DNS name (use this as your API host when ALB is enabled)"
  value       = var.enable_alb ? aws_lb.backend[0].dns_name : null
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_registry" {
  description = "ECR registry URL (for docker login)"
  value       = split("/", aws_ecr_repository.backend.repository_url)[0]
}
