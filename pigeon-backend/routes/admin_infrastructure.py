"""Admin endpoint to show AWS ASG, instances, instance refresh, and lifecycle hooks."""

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from database import admin_db
from routes.dependencies import get_current_admin, require_admin_permissions

router = APIRouter(prefix="/admin")

ASG_NAME = os.getenv("ASG_NAME", "pigeon-backend-production-asg")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
# Lifecycle hook for termination (complete-lifecycle action). Default matches infrastructure/script.sh.
_default_hook = (ASG_NAME[:-4] + "-termination-hook") if ASG_NAME.endswith("-asg") else f"{ASG_NAME}-termination-hook"
LIFECYCLE_HOOK_NAME = os.getenv("LIFECYCLE_HOOK_NAME", _default_hook)

logger = logging.getLogger(__name__)


def _serialize_dt(obj: Any) -> Any:
    """Convert datetime to ISO string for JSON."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize_dt(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_dt(v) for v in obj]
    return obj


def _fetch_infrastructure_sync() -> Dict[str, Any]:
    """Synchronous AWS calls (run in thread pool)."""
    import boto3
    from botocore.exceptions import ClientError

    result: Dict[str, Any] = {
        "asg": None,
        "instances": [],
        "instance_refreshes": [],
        "lifecycle_hooks": [],
        "error": None,
    }

    # No credentials passed: on EC2 boto3 uses the instance IAM role automatically.
    try:
        asg_client = boto3.client("autoscaling", region_name=AWS_REGION)
        ec2_client = boto3.client("ec2", region_name=AWS_REGION)
    except Exception as e:
        result["error"] = f"Failed to create AWS clients: {e}"
        return result

    # Describe Auto Scaling Group
    try:
        asg_resp = asg_client.describe_auto_scaling_groups(
            AutoScalingGroupNames=[ASG_NAME],
            MaxRecords=1,
        )
        groups = asg_resp.get("AutoScalingGroups") or []
        if not groups:
            result["error"] = f"ASG not found: {ASG_NAME}"
            return result

        group = groups[0]
        result["asg"] = {
            "name": group.get("AutoScalingGroupName"),
            "arn": group.get("AutoScalingGroupARN"),
            "min_size": group.get("MinSize"),
            "max_size": group.get("MaxSize"),
            "desired_capacity": group.get("DesiredCapacity"),
            "current_capacity": len(group.get("Instances") or []),
            "availability_zones": group.get("AvailabilityZones") or [],
            "target_group_arns": group.get("TargetGroupARNs") or [],
            "launch_template": group.get("LaunchTemplate"),
            "status": group.get("Status"),
            "created_time": group.get("CreatedTime"),
        }

        asg_instances = group.get("Instances") or []
        instance_ids = [i["InstanceId"] for i in asg_instances if i.get("InstanceId")]
        instance_map = {i["InstanceId"]: i for i in asg_instances}

        # Optionally enrich with EC2 describe_instances (state, launch time, private ip)
        if instance_ids:
            try:
                ec2_resp = ec2_client.describe_instances(InstanceIds=instance_ids)
                for resv in ec2_resp.get("Reservations") or []:
                    for inst in resv.get("Instances") or []:
                        iid = inst.get("InstanceId")
                        if not iid:
                            continue
                        info = instance_map.get(iid) or {}
                        info["ec2_state"] = inst.get("State", {}).get("Name")
                        info["launch_time"] = inst.get("LaunchTime")
                        info["private_ip"] = (
                            (inst.get("PrivateIpAddress") or "")
                            or next(
                                (
                                    x.get("PrivateIpAddress")
                                    for x in (inst.get("NetworkInterfaces") or [])
                                ),
                                None,
                            )
                        )
                        instance_map[iid] = info
            except ClientError as e:
                logger.warning("EC2 describe_instances failed: %s", e)

        result["instances"] = [
            _serialize_dt(
                {
                    "instance_id": iid,
                    "lifecycle_state": info.get("LifecycleState"),
                    "health_status": info.get("HealthStatus"),
                    "ec2_state": info.get("ec2_state"),
                    "launch_time": info.get("launch_time"),
                    "private_ip": info.get("private_ip"),
                }
            )
            for iid, info in instance_map.items()
        ]

    except ClientError as e:
        result["error"] = f"ASG describe failed: {e.response.get('Error', {}).get('Message', str(e))}"
        return result
    except Exception as e:
        result["error"] = str(e)
        return result

    # Instance refreshes (last 5)
    try:
        refresh_resp = asg_client.describe_instance_refreshes(
            AutoScalingGroupName=ASG_NAME,
            MaxRecords=5,
        )
        refreshes = refresh_resp.get("InstanceRefreshes") or []
        result["instance_refreshes"] = _serialize_dt(
            [
                {
                    "id": r.get("InstanceRefreshId"),
                    "status": r.get("Status"),
                    "status_reason": r.get("StatusReason"),
                    "start_time": r.get("StartTime"),
                    "end_time": r.get("EndTime"),
                    "percentage_complete": r.get("PercentageComplete"),
                }
                for r in refreshes
            ]
        )
    except ClientError as e:
        logger.warning("Describe instance refreshes failed: %s", e)
        result["instance_refreshes"] = []
    except Exception as e:
        logger.warning("Instance refreshes error: %s", e)
        result["instance_refreshes"] = []

    # Lifecycle hooks
    try:
        hooks_resp = asg_client.describe_lifecycle_hooks(
            AutoScalingGroupName=ASG_NAME,
        )
        hooks = hooks_resp.get("LifecycleHooks") or []
        result["lifecycle_hooks"] = _serialize_dt(
            [
                {
                    "name": h.get("LifecycleHookName"),
                    "lifecycle_transition": h.get("LifecycleTransition"),
                    "heartbeat_timeout": h.get("HeartbeatTimeout"),
                    "default_result": h.get("DefaultResult"),
                }
                for h in hooks
            ]
        )
    except ClientError as e:
        logger.warning("Describe lifecycle hooks failed: %s", e)
        result["lifecycle_hooks"] = []
    except Exception as e:
        logger.warning("Lifecycle hooks error: %s", e)
        result["lifecycle_hooks"] = []

    if result["asg"]:
        result["asg"] = _serialize_dt(result["asg"])
    return result


def _complete_lifecycle_sync() -> Dict[str, Any]:
    """Complete lifecycle action for all instances in Terminating:Wait (same logic as infrastructure/script.sh)."""
    import boto3
    from botocore.exceptions import ClientError

    result: Dict[str, Any] = {"completed": [], "error": None}
    try:
        asg_client = boto3.client("autoscaling", region_name=AWS_REGION)
        resp = asg_client.describe_auto_scaling_instances(MaxRecords=50)
        instances = resp.get("AutoScalingInstances") or []
        terminating_wait = [
            i["InstanceId"]
            for i in instances
            if i.get("AutoScalingGroupName") == ASG_NAME and i.get("LifecycleState") == "Terminating:Wait"
        ]
        if not terminating_wait:
            return result
        for instance_id in terminating_wait:
            try:
                asg_client.complete_lifecycle_action(
                    LifecycleHookName=LIFECYCLE_HOOK_NAME,
                    AutoScalingGroupName=ASG_NAME,
                    InstanceId=instance_id,
                    LifecycleActionResult="CONTINUE",
                )
                result["completed"].append(instance_id)
                logger.info("Completed lifecycle action for instance %s", instance_id)
            except ClientError as e:
                result["error"] = e.response.get("Error", {}).get("Message", str(e))
                logger.warning("complete_lifecycle_action failed for %s: %s", instance_id, e)
                break
    except ClientError as e:
        result["error"] = e.response.get("Error", {}).get("Message", str(e))
    except Exception as e:
        result["error"] = str(e)
    return result


@router.get(
    "/system/infrastructure",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def admin_get_infrastructure(
    current_admin: dict = Depends(get_current_admin),
):
    """Return ASG summary, instances (with running_jobs per instance), instance refreshes, lifecycle hooks."""
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _fetch_infrastructure_sync)
    if data.get("instances") and not data.get("error"):
        instance_ids = [inst["instance_id"] for inst in data["instances"]]
        counts: Dict[str, int] = {iid: 0 for iid in instance_ids}
        try:
            cursor = admin_db.system_jobs.find(
                {"status": "running", "runner_instance_id": {"$in": instance_ids}},
                {"runner_instance_id": 1},
            )
            async for doc in cursor:
                iid = doc.get("runner_instance_id")
                if iid and iid in counts:
                    counts[iid] += 1
            for inst in data["instances"]:
                inst["running_jobs"] = counts.get(inst["instance_id"], 0)
            data["total_running_jobs"] = sum(counts.values())
        except Exception as e:
            logger.warning("Failed to get running job counts: %s", e)
            for inst in data["instances"]:
                inst["running_jobs"] = None
            data["total_running_jobs"] = None
    else:
        try:
            data["total_running_jobs"] = await admin_db.system_jobs.count_documents({"status": "running"})
        except Exception as e:
            logger.warning("Failed to get running job count: %s", e)
            data["total_running_jobs"] = None
    return data


@router.post(
    "/system/infrastructure/complete-lifecycle",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def admin_complete_lifecycle(
    current_admin: dict = Depends(get_current_admin),
):
    """Complete lifecycle action for all instances in Terminating:Wait (same as infrastructure/script.sh)."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _complete_lifecycle_sync)
    return result
