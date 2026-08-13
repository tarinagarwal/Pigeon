"""Email template routes"""
from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone

from database import db
from models import EmailTemplate

router = APIRouter()

@router.post("/templates")
async def create_template(template: EmailTemplate):
    """Create email template"""
    template.updated_at = datetime.now(timezone.utc)
    template_dict = template.model_dump()
    await db.templates.insert_one(template_dict)
    template_dict.pop("_id", None)  # Remove MongoDB _id before returning
    return template_dict

@router.get("/templates")
async def get_templates(user_id: str):
    """Get all templates for user, sorted by most recently edited first"""
    templates = await db.templates.find(
        {"user_id": user_id},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(None)
    return templates

@router.put("/templates/{template_id}")
async def update_template(template_id: str, template: EmailTemplate):
    """Update email template"""
    template.updated_at = datetime.now(timezone.utc)
    template_dict = template.model_dump()
    await db.templates.update_one(
        {"id": template_id},
        {"$set": template_dict}
    )
    template_dict.pop("_id", None)
    return template_dict

@router.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    """Delete email template. Cannot delete if used by any campaign."""
    used = await db.campaigns.count_documents({"template_ids": template_id})
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete template: it is used by one or more campaigns.",
        )
    result = await db.templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted"}
