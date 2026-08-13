import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from database import db, admin_db
from models import (
    Workflow,
    WorkflowNode,
    WorkflowEdge,
    WorkflowRun,
    WorkflowRunStep,
    WorkflowWait,
)


class WorkflowService:
    """Service responsible for executing workflow nodes and coordinating waits.

    This initial version focuses on a minimal but powerful subset of nodes:
    - SendEmail: send a single email to a contact using an existing template.
    - WaitFor (duration-only): wait N days/hours before moving to the next node.
    - IfCondition: branch based on basic status conditions.
    - End: mark the run as completed.
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    async def create_workflow(self, data: Dict[str, Any]) -> Dict[str, Any]:
        wf = Workflow(**data)
        doc = wf.model_dump()
        await db.workflows.insert_one(doc)
        doc.pop("_id", None)
        return doc

    async def list_workflows(self, user_id: str) -> List[Dict[str, Any]]:
        rows = await db.workflows.find({"user_id": user_id}, {"_id": 0}).sort(
            "created_at", -1
        ).to_list(None)
        return rows

    async def start_workflow_manual(
        self,
        workflow_id: str,
        user_id: str,
        trigger_context: Dict[str, Any],
    ) -> Optional[WorkflowRun]:
        """Create a one-off test run for a specific workflow.

        This bypasses trigger-matching and starts the workflow directly using
        its current definition and trigger configuration.
        """
        wf_doc = await db.workflows.find_one(
            {"id": workflow_id, "user_id": user_id},
            {"_id": 0},
        )
        if not wf_doc:
            return None

        workflow = Workflow(**wf_doc)

        # Create the run with the provided trigger context.
        run = await self.create_run(workflow=workflow, trigger_context=trigger_context)

        # Resolve entry nodes using explicit Start node(s) when present.
        start_nodes = self._resolve_entry_nodes(workflow)
        if not start_nodes:
            return run

        # For manual test runs, execute inline and do not enqueue background jobs.
        await self._run_workflow_inline(workflow=workflow, run=run, entry_node_ids=start_nodes)
        return run

    async def _run_workflow_inline(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        entry_node_ids: List[str],
    ) -> None:
        """Execute a workflow synchronously starting from given entry nodes.

        This is used only for manual "Test run" so the user sees immediate
        results without waiting for background workers.
        """
        pending: List[str] = list(entry_node_ids)

        while pending:
            node_id = pending.pop(0)

            node = next((n for n in workflow.nodes if n.id == node_id), None)
            if not node:
                self.logger.warning("Inline run: node %s not found in workflow %s", node_id, workflow.id)
                continue

            # Build context snapshot before this node executes.
            context_before: Dict[str, Any] = dict(run.trigger_context or {})
            last_step = await db.workflow_run_steps.find_one(
                {"workflow_run_id": run.id},
                sort=[("started_at", -1)],
            )
            if last_step and last_step.get("context_after"):
                try:
                    context_before.update(last_step["context_after"])
                except Exception:
                    self.logger.warning(
                        "Inline run: failed to merge context_after for run %s step %s",
                        run.id,
                        last_step.get("id"),
                    )

            step = WorkflowRunStep(
                workflow_run_id=run.id,
                node_id=node_id,
                status="running",
                started_at=datetime.now(timezone.utc),
                context_before=context_before,
            )
            step_doc = step.model_dump()
            await db.workflow_run_steps.insert_one(step_doc)

            try:
                next_nodes, wait, context_delta = await self._execute_node(
                    workflow, run, node, context_before
                )
                status = "completed"
                error_text: Optional[str] = None

                # For manual test runs, do not persist waits or enqueue jobs; instead,
                # treat waits as having completed immediately and continue.
                if wait:
                    next_nodes = self._get_next_nodes(workflow, node, branch_label=None)
            except Exception as exc:
                self.logger.error(
                    "Inline workflow step failed run_id=%s node_id=%s: %s", run.id, node_id, exc
                )
                status = "failed"
                error_text = str(exc)
                context_delta = {}

            context_after: Dict[str, Any] = dict(context_before)
            try:
                context_after.update(context_delta or {})
            except Exception:
                self.logger.warning(
                    "Inline run: failed to merge context_delta for run %s node %s", run.id, node_id
                )

            await db.workflow_run_steps.update_one(
                {"id": step.id},
                {
                    "$set": {
                        "status": status,
                        "completed_at": datetime.now(timezone.utc),
                        "error": error_text,
                        "updated_at": datetime.now(timezone.utc),
                        "context_before": context_before,
                        "context_after": context_after,
                    }
                },
            )

            # Queue next nodes immediately.
            if status == "completed":
                for next_id in next_nodes:
                    pending.append(next_id)

        # After inline execution, mark run as completed if it is not already.
        await db.workflow_runs.update_one(
            {"id": run.id},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    def _resolve_entry_nodes(self, workflow: Workflow) -> List[str]:
        """Determine which node(s) should be treated as workflow entry points.

        Priority:
        1. If there is at least one node of type "Start", use the targets
           of its outgoing edges as entry nodes.
        2. Otherwise, fall back to nodes with no incoming edges.
        3. If every node has an incoming edge, fall back to the first node.
        """
        # 1) Explicit Start node(s)
        start_ids = [
            n.id for n in workflow.nodes if (n.type or "").lower() == "start"
        ]
        if start_ids:
            targets: List[str] = [
                e.target_node_id
                for e in workflow.edges
                if e.source_node_id in start_ids
            ]
            # Deduplicate while preserving order
            seen: set[str] = set()
            deduped: List[str] = []
            for t in targets:
                if t and t not in seen:
                    seen.add(t)
                    deduped.append(t)
            if deduped:
                return deduped

        # 2) Nodes with no incoming edges
        incoming = {e.target_node_id for e in workflow.edges}
        start_nodes = [n.id for n in workflow.nodes if n.id not in incoming]
        if start_nodes:
            return start_nodes

        # 3) Fallback: first node
        if workflow.nodes:
            return [workflow.nodes[0].id]
        return []

    async def get_workflow(self, workflow_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        row = await db.workflows.find_one(
            {"id": workflow_id, "user_id": user_id},
            {"_id": 0},
        )
        return row

    async def update_workflow(
        self, workflow_id: str, user_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        data["updated_at"] = datetime.now(timezone.utc)
        await db.workflows.update_one(
            {"id": workflow_id, "user_id": user_id},
            {"$set": data},
        )
        row = await db.workflows.find_one(
            {"id": workflow_id, "user_id": user_id},
            {"_id": 0},
        )
        return row

    async def delete_workflow(self, workflow_id: str, user_id: str) -> bool:
        """Delete a workflow and its associated runs/steps/waits."""
        wf = await db.workflows.find_one({"id": workflow_id, "user_id": user_id})
        if not wf:
            return False
        await db.workflows.delete_one({"id": workflow_id, "user_id": user_id})
        await db.workflow_runs.delete_many({"workflow_id": workflow_id, "user_id": user_id})
        await db.workflow_run_steps.delete_many({"workflow_run_id": {"$in": [r["id"] for r in await db.workflow_runs.find({"workflow_id": workflow_id, "user_id": user_id}, {"id": 1}).to_list(None)]}})
        await db.workflow_waits.delete_many({"workflow_run_id": {"$in": [r["id"] for r in await db.workflow_runs.find({"workflow_id": workflow_id, "user_id": user_id}, {"id": 1}).to_list(None)]}})
        return True

    async def set_workflow_status(
        self, workflow_id: str, user_id: str, status: str
    ) -> Optional[Dict[str, Any]]:
        await db.workflows.update_one(
            {"id": workflow_id, "user_id": user_id},
            {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
        )
        row = await db.workflows.find_one(
            {"id": workflow_id, "user_id": user_id},
            {"_id": 0},
        )
        return row

    # ------------------------------------------------------------------
    # Triggers
    # ------------------------------------------------------------------

    async def trigger_matching_workflows(
        self,
        event_type: str,
        trigger_context: Dict[str, Any],
    ) -> None:
        """Find and start all active workflows whose trigger matches this event.

        event_type: e.g. onCampaignStarted, onEmailSent, onEmailOpened, onEmailReplied.
        trigger_context: should include relevant ids like campaign_id, list_id, contact_id, email_log_id.
        """
        campaign_id = trigger_context.get("campaign_id")
        list_id = trigger_context.get("list_id")
        contact_id = trigger_context.get("contact_id")

        base_query: Dict[str, Any] = {
            "status": "active",
            "trigger.type": event_type,
        }

        # Campaign-level filter (for workflows that optionally pin to a campaign)
        if campaign_id:
            base_query.setdefault("$and", []).append(
                {
                    "$or": [
                        {"trigger.campaign_id": {"$exists": False}},
                        {"trigger.campaign_id": None},
                        {"trigger.campaign_id": campaign_id},
                    ]
                }
            )

        # List-level filter (optional pin to specific list when we know list_id)
        if list_id:
            base_query.setdefault("$and", []).append(
                {
                    "$or": [
                        {"trigger.list_id": {"$exists": False}},
                        {"trigger.list_id": None},
                        {"trigger.list_id": list_id},
                    ]
                }
            )

        # Contact-level filter (optional pin to specific contact when we know contact_id)
        if contact_id:
            base_query.setdefault("$and", []).append(
                {
                    "$or": [
                        {"trigger.contact_id": {"$exists": False}},
                        {"trigger.contact_id": None},
                        {"trigger.contact_id": contact_id},
                    ]
                }
            )

        cursor = db.workflows.find(base_query)
        async for wf_doc in cursor:
            try:
                wf = Workflow(**{k: v for k, v in wf_doc.items() if k != "_id"})
            except Exception:
                continue

            scope = (wf.scope or "").lower()
            # Enforce minimal required context per scope so we don't start nonsense runs.
            if scope == "campaign" and not campaign_id:
                continue
            if scope == "contact" and not contact_id:
                continue
            # For list/global scopes we don't require a specific id; they can use generic context.

            run = await self.create_run(workflow=wf, trigger_context=trigger_context)

            # Resolve entry nodes using explicit Start node(s) when present.
            start_nodes = self._resolve_entry_nodes(wf)
            if not start_nodes:
                continue

            now_utc = datetime.now(timezone.utc)
            for node_id in start_nodes:
                await self._enqueue_workflow_step_job(
                    workflow_id=wf.id,
                    workflow_run_id=run.id,
                    node_id=node_id,
                    scheduled_at=now_utc,
                )

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def create_run(
        self,
        workflow: Workflow,
        trigger_context: Dict[str, Any],
    ) -> WorkflowRun:
        run = WorkflowRun(
            workflow_id=workflow.id,
            user_id=workflow.user_id,
            trigger_context=trigger_context,
        )
        doc = run.model_dump()
        await db.workflow_runs.insert_one(doc)
        return run

    async def get_run(self, run_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        row = await db.workflow_runs.find_one(
            {"id": run_id, "user_id": user_id},
            {"_id": 0},
        )
        return row

    async def list_runs(
        self, workflow_id: str, user_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        rows = await db.workflow_runs.find(
            {"workflow_id": workflow_id, "user_id": user_id},
            {"_id": 0},
        ).sort("started_at", -1).limit(limit).to_list(None)
        return rows

    async def cancel_run(self, run_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Cancel a workflow run and any pending step jobs.

        This marks the run as cancelled and updates any pending workflow_step
        jobs so AutomationService will skip them.
        """
        run_doc = await db.workflow_runs.find_one(
            {"id": run_id, "user_id": user_id},
            {"_id": 0},
        )
        if not run_doc:
            return None

        now = datetime.now(timezone.utc)
        await db.workflow_runs.update_one(
            {"id": run_id, "user_id": user_id},
            {
                "$set": {
                    "status": "cancelled",
                    "updated_at": now,
                    "completed_at": run_doc.get("completed_at") or now,
                }
            },
        )

        # Mark any pending workflow_step jobs for this run as cancelled so they
        # are not picked up by AutomationService.
        await admin_db.system_jobs.update_many(
            {
                "job_type": "workflow_step",
                "action_config.workflow_run_id": run_id,
                "status": "pending",
            },
            {
                "$set": {
                    "status": "cancelled",
                    "finished_at": now,
                }
            },
        )

        updated = await db.workflow_runs.find_one(
            {"id": run_id, "user_id": user_id},
            {"_id": 0},
        )
        return updated

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def run_step(
        self,
        workflow_run_id: str,
        node_id: str,
    ) -> None:
        """Execute a single node in a workflow run.

        This is invoked from AutomationService via a workflow_step job.
        """
        run_doc = await db.workflow_runs.find_one({"id": workflow_run_id})
        if not run_doc:
            self.logger.warning("WorkflowRun %s not found", workflow_run_id)
            return
        run = WorkflowRun(**{k: v for k, v in run_doc.items() if k != "_id"})
        wf_doc = await db.workflows.find_one({"id": run.workflow_id})
        if not wf_doc:
            self.logger.warning("Workflow %s not found for run %s", run.workflow_id, workflow_run_id)
            return
        workflow = Workflow(**{k: v for k, v in wf_doc.items() if k != "_id"})

        node = next((n for n in workflow.nodes if n.id == node_id), None)
        if not node:
            self.logger.warning("Workflow node %s not found in workflow %s", node_id, workflow.id)
            return

        # Build context snapshot before this node executes.
        context_before: Dict[str, Any] = dict(run.trigger_context or {})
        # Merge in the context_after of the most recent completed step, if any.
        last_step = await db.workflow_run_steps.find_one(
            {"workflow_run_id": workflow_run_id},
            sort=[("started_at", -1)],
        )
        if last_step and last_step.get("context_after"):
            try:
                context_before.update(last_step["context_after"])
            except Exception:
                # Defensive: never fail a run because of bad context shape.
                self.logger.warning(
                    "Failed to merge context_after for run %s step %s",
                    workflow_run_id,
                    last_step.get("id"),
                )

        step = WorkflowRunStep(
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            status="running",
            started_at=datetime.now(timezone.utc),
            context_before=context_before,
        )
        step_doc = step.model_dump()
        await db.workflow_run_steps.insert_one(step_doc)

        try:
            next_nodes, wait, context_delta = await self._execute_node(
                workflow, run, node, context_before
            )
            status = "completed"
            error_text: Optional[str] = None
            if wait:
                # Persist wait and do not enqueue next nodes yet.
                await db.workflow_waits.insert_one(wait.model_dump())
            else:
                # Enqueue next nodes by creating workflow_step jobs
                for next_node_id in next_nodes:
                    await self._enqueue_workflow_step_job(
                        workflow_id=workflow.id,
                        workflow_run_id=workflow_run_id,
                        node_id=next_node_id,
                        scheduled_at=datetime.now(timezone.utc),
                    )
        except Exception as exc:  # pragma: no cover - defensive
            self.logger.error(
                "Workflow step failed run_id=%s node_id=%s: %s", workflow_run_id, node_id, exc
            )
            status = "failed"
            error_text = str(exc)
            context_delta = {}

        context_after: Dict[str, Any] = dict(context_before)
        try:
            context_after.update(context_delta or {})
        except Exception:
            self.logger.warning(
                "Failed to merge context_delta for run %s node %s", workflow_run_id, node_id
            )

        await db.workflow_run_steps.update_one(
            {"id": step.id},
            {
                "$set": {
                    "status": status,
                    "completed_at": datetime.now(timezone.utc),
                    "error": error_text,
                    "updated_at": datetime.now(timezone.utc),
                    "context_before": context_before,
                    "context_after": context_after,
                }
            },
        )

        # If End node, mark run completed.
        if node.type == "End" and status == "completed":
            await db.workflow_runs.update_one(
                {"id": workflow_run_id},
                {
                    "$set": {
                        "status": "completed",
                        "completed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

    async def _execute_node(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        context: Dict[str, Any],
    ) -> Tuple[List[str], Optional[WorkflowWait], Dict[str, Any]]:
        """Execute a node and return (next_node_ids, wait_or_none, context_delta)."""
        node_type = node.type
        cfg = node.config or {}

        if node_type == "SendEmail":
            context_delta = await self._handle_send_email(workflow, run, node, cfg, context)
            return self._get_next_nodes(workflow, node, branch_label=None), None, context_delta

        if node_type == "WaitFor":
            mode = cfg.get("mode") or "duration"
            if mode == "duration":
                # For manual test runs (source=manual_test in context), we skip
                # real waiting and immediately continue to the next node so the
                # test completes inline.
                if (context.get("source") or "").lower() == "manual_test":
                    return self._get_next_nodes(workflow, node, branch_label=None), None, {}
                duration_days = cfg.get("duration_days") or 0
                duration_hours = cfg.get("duration_hours") or 0
                until = datetime.now(timezone.utc) + timedelta(
                    days=duration_days, hours=duration_hours
                )
                wait = WorkflowWait(
                    workflow_run_id=run.id,
                    node_id=node.id,
                    user_id=run.user_id,
                    campaign_id=context.get("campaign_id") or run.trigger_context.get("campaign_id"),
                    list_id=context.get("list_id") or run.trigger_context.get("list_id"),
                    contact_id=context.get("contact_id") or run.trigger_context.get("contact_id"),
                    email_log_id=context.get("email_log_id") or run.trigger_context.get(
                        "email_log_id"
                    ),
                    event_type=None,
                    until_time=until,
                )
                # Schedule a job at "until" to resume this node and move to next.
                await self._enqueue_workflow_step_job(
                    workflow_id=workflow.id,
                    workflow_run_id=run.id,
                    node_id=node.id,
                    scheduled_at=until,
                )
                return [], wait, {}

        if node_type == "IfCondition":
            branch = await self._evaluate_condition(workflow, run, node, cfg, context)
            context_delta = {"last_condition_result": branch}
            return (
                self._get_next_nodes(workflow, node, branch_label=branch),
                None,
                context_delta,
            )

        if node_type == "AddToList":
            context_delta = await self._handle_add_to_list(workflow, run, node, cfg, context)
            return self._get_next_nodes(workflow, node, branch_label=None), None, context_delta

        if node_type == "RemoveFromList":
            context_delta = await self._handle_remove_from_list(workflow, run, node, cfg, context)
            return self._get_next_nodes(workflow, node, branch_label=None), None, context_delta

        if node_type == "UpdateContactStatus":
            context_delta = await self._handle_update_contact_status(
                workflow, run, node, cfg, context
            )
            return self._get_next_nodes(workflow, node, branch_label=None), None, context_delta

        if node_type == "SendWebhook":
            context_delta = await self._handle_send_webhook(
                workflow, run, node, cfg, context
            )
            return self._get_next_nodes(workflow, node, branch_label=None), None, context_delta

        if node_type == "End":
            # No next nodes.
            return [], None, {}

        # Default: unknown node type, just move to default outgoing edges.
        self.logger.warning("Unknown workflow node type %s; falling through", node_type)
        return self._get_next_nodes(workflow, node, branch_label=None), None, {}

    async def _handle_send_email(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Send a single email for SendEmail node.

        This delegates to the existing email send endpoint by inserting a SystemJob
        that will be picked up by the email pipeline, or by directly inserting
        an email log if the pipeline requires it.

        For now we use a minimal implementation that relies on existing campaigns.

        ID resolution rules:
        - Prefer explicit ids in node config.
        - Fall back to workflow context (built from trigger_context and previous steps).
        """
        campaign_id = cfg.get("campaign_id") or context.get("campaign_id") or run.trigger_context.get(
            "campaign_id"
        )
        contact_id = cfg.get("contact_id") or context.get("contact_id") or run.trigger_context.get(
            "contact_id"
        )
        template_id = cfg.get("template_id")
        user_id = run.user_id
        if not (campaign_id and contact_id and template_id and user_id):
            self.logger.warning(
                "SendEmail node missing required ids (campaign/contact/template/user); skipping. "
                "workflow_id=%s run_id=%s node_id=%s",
                workflow.id,
                run.id,
                node.id,
            )
            return {}
        # Insert a lightweight record into a dedicated collection so an existing
        # email send path can pick it up later if needed. For now, we just log intent.
        await db.workflow_email_intents.insert_one(
            {
                "id": f"{run.id}:{node.id}",
                "workflow_id": workflow.id,
                "workflow_run_id": run.id,
                "node_id": node.id,
                "user_id": user_id,
                "campaign_id": campaign_id,
                "contact_id": contact_id,
                "template_id": template_id,
                "created_at": datetime.now(timezone.utc),
            }
        )
        # Expose what we actually used back to the workflow context so downstream
        # nodes can reference these ids without re-configuring.
        return {
            "campaign_id": campaign_id,
            "contact_id": contact_id,
        }

    async def _handle_add_to_list(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Append the current contact to a contact list."""
        list_id = cfg.get("list_id") or context.get("list_id") or run.trigger_context.get(
            "list_id"
        )
        contact_id = context.get("contact_id") or run.trigger_context.get("contact_id")
        if not list_id or not contact_id:
            self.logger.warning(
                "AddToList node missing list_id/contact_id; skipping. workflow_id=%s run_id=%s node_id=%s",
                workflow.id,
                run.id,
                node.id,
            )
            return {}
        await db.contact_lists.update_one(
            {"id": list_id, "user_id": run.user_id},
            {"$addToSet": {"contact_ids": contact_id}},
        )
        return {"list_id": list_id}

    async def _handle_remove_from_list(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Remove the current contact from one or more contact lists."""
        contact_id = context.get("contact_id") or run.trigger_context.get("contact_id")
        if not contact_id:
            self.logger.warning(
                "RemoveFromList node missing contact_id; skipping. workflow_id=%s run_id=%s node_id=%s",
                workflow.id,
                run.id,
                node.id,
            )
            return {}

        list_id = cfg.get("list_id") or context.get("list_id") or run.trigger_context.get(
            "list_id"
        )
        all_for_campaign = bool(cfg.get("all_lists_for_campaign"))

        if list_id:
            await db.contact_lists.update_one(
                {"id": list_id, "user_id": run.user_id},
                {"$pull": {"contact_ids": contact_id}},
            )
            return {"list_id": list_id}

        if all_for_campaign:
            campaign_id = (
                context.get("campaign_id")
                or run.trigger_context.get("campaign_id")
            )
            if not campaign_id:
                return {}
            # Remove the contact from any lists attached to this campaign.
            campaign = await db.campaigns.find_one(
                {"id": campaign_id, "user_id": run.user_id},
                {"contact_list_ids": 1},
            )
            if campaign:
                for cid in campaign.get("contact_list_ids") or []:
                    await db.contact_lists.update_one(
                        {"id": cid, "user_id": run.user_id},
                        {"$pull": {"contact_ids": contact_id}},
                    )
            return {"campaign_id": campaign_id}

        return {}

    async def _handle_send_webhook(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """POST the current contact + status + event to a user-provided URL.

        This is a low-level, per-workflow webhook node (different from user-wide webhooks).
        """
        url = (cfg.get("url") or "").strip()
        if not url:
            self.logger.warning(
                "SendWebhook node missing url; skipping. workflow_id=%s run_id=%s node_id=%s",
                workflow.id,
                run.id,
                node.id,
            )
            return {}

        # Resolve ids from context/trigger.
        campaign_id = context.get("campaign_id") or run.trigger_context.get("campaign_id")
        list_id = context.get("list_id") or run.trigger_context.get("list_id")
        contact_id = context.get("contact_id") or run.trigger_context.get("contact_id")
        email_log_id = context.get("email_log_id") or run.trigger_context.get("email_log_id")

        # Map workflow trigger type to a more generic event name when possible.
        # WorkflowRun does not carry the trigger object, so use the workflow's
        # trigger definition when available and fall back to raw event type.
        trigger_type = (workflow.trigger.type if getattr(workflow, "trigger", None) else None) or (
            context.get("event_type") or run.trigger_context.get("event_type") or ""
        )
        event = cfg.get("event") or {
            "onEmailSent": "email.sent",
            "onEmailOpened": "email.opened",
            "onEmailReplied": "email.replied",
            "onCampaignStarted": "campaign.started",
        }.get(trigger_type, trigger_type)

        # Load contact details and status if we have a contact_id.
        contact_doc: Optional[Dict[str, Any]] = None
        if contact_id:
            try:
                contact_doc = await db.contacts.find_one(
                    {"id": contact_id, "user_id": run.user_id},
                    {
                        "_id": 0,
                        "id": 1,
                        "email": 1,
                        "first_name": 1,
                        "last_name": 1,
                        "company": 1,
                        "status": 1,
                    },
                )
            except Exception:
                contact_doc = None

        status = contact_doc.get("status") if contact_doc else None

        # Optionally load campaign and list names so the webhook payload is
        # easier to consume (ids + human-readable labels).
        campaign_doc: Optional[Dict[str, Any]] = None
        if campaign_id:
            try:
                campaign_doc = await db.campaigns.find_one(
                    {"id": campaign_id, "user_id": run.user_id},
                    {"_id": 0, "id": 1, "name": 1},
                )
            except Exception:
                campaign_doc = None

        list_doc: Optional[Dict[str, Any]] = None
        if list_id:
            try:
                list_doc = await db.contact_lists.find_one(
                    {"id": list_id, "user_id": run.user_id},
                    {"_id": 0, "id": 1, "name": 1},
                )
            except Exception:
                list_doc = None

        payload: Dict[str, Any] = {
            "event": event,
            "workflow": {
                "id": workflow.id,
                "name": workflow.name,
            },
            "workflow_run_id": run.id,
            "node": {
                "id": node.id,
                "type": node.type,
                "label": node.label,
            },
            "user_id": run.user_id,
            "campaign": campaign_doc or {"id": campaign_id} if campaign_id else None,
            "list": list_doc or {"id": list_id} if list_id else None,
            "contact_id": contact_id,
            "email_log_id": email_log_id,
            "status": status,
            "contact": contact_doc,
            "trigger_context": run.trigger_context,
        }

        # Fire-and-forget HTTP POST – errors are logged but do not fail the workflow run.
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                return {
                    "last_webhook_status": resp.status_code,
                    "last_webhook_url": url,
                }
        except Exception as exc:  # pragma: no cover - side effect only
            self.logger.warning(
                "SendWebhook node error url=%s workflow_id=%s run_id=%s node_id=%s err=%s",
                url,
                workflow.id,
                run.id,
                node.id,
                exc,
            )
            return {
                "last_webhook_error": str(exc),
                "last_webhook_url": url,
            }

    async def _handle_update_contact_status(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Update the status of the current contact (and related campaign contact, if any)."""
        contact_id = context.get("contact_id") or run.trigger_context.get("contact_id")
        status = (cfg.get("status") or "").strip()
        if not contact_id or not status:
            self.logger.warning(
                "UpdateContactStatus node missing contact_id/status; skipping. workflow_id=%s run_id=%s node_id=%s",
                workflow.id,
                run.id,
                node.id,
            )
            return {}

        now = datetime.now(timezone.utc)
        await db.contacts.update_one(
            {"id": contact_id},
            {
                "$set": {
                    "status": status,
                    "updated_at": now,
                }
            },
        )

        campaign_id = (
            context.get("campaign_id")
            or run.trigger_context.get("campaign_id")
        )
        if campaign_id:
            await db.campaign_contacts.update_one(
                {"campaign_id": campaign_id, "contact_id": contact_id},
                {
                    "$set": {
                        "status": status,
                        "last_activity": now,
                        "updated_at": now,
                    }
                },
            )

        return {"contact_status": status}

    async def _evaluate_condition(
        self,
        workflow: Workflow,
        run: WorkflowRun,
        node: WorkflowNode,
        cfg: Dict[str, Any],
        context: Dict[str, Any],
    ) -> str:
        """Evaluate a simple status-based condition and return a branch label."""
        contact_id = (
            context.get("contact_id")
            or run.trigger_context.get("contact_id")
        )
        status_equals = (cfg.get("status_equals") or "").strip()
        if not contact_id or not status_equals:
            return "No"
        contact = await db.contacts.find_one({"id": contact_id}, {"status": 1})
        if not contact:
            return "No"
        return "Yes" if contact.get("status") == status_equals else "No"

    def _get_next_nodes(
        self,
        workflow: Workflow,
        node: WorkflowNode,
        branch_label: Optional[str],
    ) -> List[str]:
        """Resolve outgoing edges for node, optionally filtered by label."""
        if branch_label is None:
            return [
                e.target_node_id
                for e in workflow.edges
                if e.source_node_id == node.id
            ]
        labeled = [
            e.target_node_id
            for e in workflow.edges
            if e.source_node_id == node.id and (e.label or "").lower() == branch_label.lower()
        ]
        if labeled:
            return labeled
        # Fallback to unlabeled edges if no exact branch found.
        return [
            e.target_node_id
            for e in workflow.edges
            if e.source_node_id == node.id and not e.label
        ]

    async def _enqueue_workflow_step_job(
        self,
        workflow_id: str,
        workflow_run_id: str,
        node_id: str,
        scheduled_at: Optional[datetime],
    ) -> None:
        """Create a SystemJob of type workflow_step for AutomationService to process."""
        from admin_models import SystemJob

        run_at = scheduled_at or datetime.now(timezone.utc)
        job = SystemJob(
            rule_id=None,
            job_type="workflow_step",
            action_config={
                "workflow_id": workflow_id,
                "workflow_run_id": workflow_run_id,
                "node_id": node_id,
            },
            status="pending",
            scheduled_at=run_at,
        )
        await admin_db.system_jobs.insert_one(job.model_dump())

