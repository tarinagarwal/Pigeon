"""Workflow engine routes: CRUD and monitoring for email workflows."""

from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Body, Query

from database import db
from models import Workflow
from routes.dependencies import get_current_user
from services.workflow_service import WorkflowService


router = APIRouter()

# Injected from server.py
workflow_service: Optional[WorkflowService] = None


def init_workflow_service(service: WorkflowService) -> None:
  """Initialize workflow service from application startup."""
  global workflow_service
  workflow_service = service


def _ensure_service() -> WorkflowService:
  if workflow_service is None:
    raise HTTPException(status_code=500, detail="Workflow service not configured")
  return workflow_service


@router.get("/workflows")
async def list_workflows(user_id: str) -> Dict[str, Any]:
  """List workflows for a user."""
  service = _ensure_service()
  items = await service.list_workflows(user_id=user_id)
  return {"workflows": items}


@router.post("/workflows")
async def create_workflow(
  payload: Dict[str, Any] = Body(...),
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Create a new workflow for the current user."""
  service = _ensure_service()
  user_id = current_user["id"]
  # Enforce user_id from auth, not payload
  data = dict(payload)
  data["user_id"] = user_id
  # Set defaults similar to model
  if "status" not in data:
    data["status"] = "draft"
  if "scope" not in data:
    data["scope"] = "campaign"
  wf = Workflow(**data)
  created = await service.create_workflow(wf.model_dump())
  return created


@router.get("/workflows/{workflow_id}")
async def get_workflow(
  workflow_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Get a single workflow definition (owner only)."""
  service = _ensure_service()
  user_id = current_user["id"]
  row = await service.get_workflow(workflow_id=workflow_id, user_id=user_id)
  if not row:
    raise HTTPException(status_code=404, detail="Workflow not found")
  return row


@router.put("/workflows/{workflow_id}")
async def update_workflow(
  workflow_id: str,
  payload: Dict[str, Any] = Body(...),
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Update a workflow definition (owner only)."""
  service = _ensure_service()
  user_id = current_user["id"]
  # Do not allow changing user_id from payload
  data = dict(payload)
  data["user_id"] = user_id
  # Basic validation: ensure all edges point to existing nodes.
  try:
    nodes = {n["id"] for n in data.get("nodes") or [] if isinstance(n, dict) and "id" in n}
    bad_edges = []
    for e in data.get("edges") or []:
      if not isinstance(e, dict):
        continue
      sid = e.get("source_node_id")
      tid = e.get("target_node_id")
      if sid not in nodes or tid not in nodes:
        bad_edges.append(e)
    if bad_edges:
      raise HTTPException(
        status_code=400,
        detail="Workflow has edges pointing to missing nodes. Please fix the graph before saving.",
      )
  except HTTPException:
    raise
  except Exception:
    # If validation itself fails, fall through and let the update proceed rather than blocking.
    pass
  updated = await service.update_workflow(
    workflow_id=workflow_id,
    user_id=user_id,
    data=data,
  )
  if not updated:
    raise HTTPException(status_code=404, detail="Workflow not found")
  return updated


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(
  workflow_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Delete a workflow (owner only)."""
  service = _ensure_service()
  user_id = current_user["id"]
  deleted = await service.delete_workflow(workflow_id=workflow_id, user_id=user_id)
  if not deleted:
    raise HTTPException(status_code=404, detail="Workflow not found")
  return {"deleted": True}


@router.post("/workflows/{workflow_id}/activate")
async def activate_workflow(
  workflow_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Activate a workflow so it starts responding to triggers."""
  service = _ensure_service()
  user_id = current_user["id"]
  row = await service.set_workflow_status(
    workflow_id=workflow_id,
    user_id=user_id,
    status="active",
  )
  if not row:
    raise HTTPException(status_code=404, detail="Workflow not found")
  return row


@router.post("/workflows/{workflow_id}/pause")
async def pause_workflow(
  workflow_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Pause a workflow (no new runs will be started)."""
  service = _ensure_service()
  user_id = current_user["id"]
  row = await service.set_workflow_status(
    workflow_id=workflow_id,
    user_id=user_id,
    status="paused",
  )
  if not row:
    raise HTTPException(status_code=404, detail="Workflow not found")
  return row


@router.post("/workflows/{workflow_id}/test")
async def test_workflow(
  workflow_id: str,
  payload: Dict[str, Any] = Body(default_factory=dict),
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Create a one-off test run for this workflow.

  This starts the workflow immediately using a synthetic trigger event so you
  can verify that the graph executes end‑to‑end.
  """
  service = _ensure_service()
  user_id = current_user["id"]

  # Ensure the workflow belongs to this user before starting a run.
  wf = await db.workflows.find_one({"id": workflow_id}, {"user_id": 1, "trigger": 1})
  if not wf or wf.get("user_id") != user_id:
    raise HTTPException(status_code=404, detail="Workflow not found")

  trigger_context: Dict[str, Any] = dict(payload.get("trigger_context") or {})
  # Mark this as a manual test run for downstream inspection.
  trigger_context.setdefault("source", "manual_test")
  trigger_context.setdefault("workflow_id", workflow_id)

  run = await service.start_workflow_manual(
    workflow_id=workflow_id,
    user_id=user_id,
    trigger_context=trigger_context,
  )
  if not run:
    raise HTTPException(status_code=404, detail="Workflow not found")

  run_dict = run.model_dump()
  run_dict.pop("_id", None)
  steps: List[Dict[str, Any]] = await db.workflow_run_steps.find(
    {"workflow_run_id": run.id},
    {"_id": 0},
  ).sort("started_at", 1).to_list(None)
  return {"run": run_dict, "steps": steps}


@router.get("/workflows/{workflow_id}/runs")
async def list_workflow_runs(
  workflow_id: str,
  limit: int = Query(20, ge=1, le=100),
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """List recent runs for a workflow (owner only)."""
  service = _ensure_service()
  user_id = current_user["id"]
  # Validate ownership via workflow document
  wf = await db.workflows.find_one({"id": workflow_id}, {"user_id": 1})
  if not wf or wf.get("user_id") != user_id:
    raise HTTPException(status_code=404, detail="Workflow not found")
  runs = await service.list_runs(workflow_id=workflow_id, user_id=user_id, limit=limit)
  return {"runs": runs}


@router.get("/workflows/runs/{run_id}")
async def get_workflow_run(
  run_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Get a workflow run and its steps (owner only)."""
  service = _ensure_service()
  user_id = current_user["id"]
  run = await service.get_run(run_id=run_id, user_id=user_id)
  if not run:
    raise HTTPException(status_code=404, detail="Workflow run not found")
  steps: List[Dict[str, Any]] = await db.workflow_run_steps.find(
    {"workflow_run_id": run_id},
    {"_id": 0},
  ).sort("started_at", 1).to_list(None)
  return {"run": run, "steps": steps}


@router.post("/workflows/runs/{run_id}/stop")
async def stop_workflow_run(
  run_id: str,
  current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
  """Stop a single workflow run and cancel any pending steps."""
  service = _ensure_service()
  user_id = current_user["id"]
  updated = await service.cancel_run(run_id=run_id, user_id=user_id)
  if not updated:
    raise HTTPException(status_code=404, detail="Workflow run not found")
  return {"run": updated}

