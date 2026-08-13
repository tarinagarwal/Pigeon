"""Subdomain management routes"""
from fastapi import APIRouter, HTTPException, Depends

from database import db
from routes.dependencies import get_current_user, verify_domain_ownership
from routes.schemas import CreateSubdomainRequest
from services.domain_service import DomainService

router = APIRouter()

# Initialize service (will be injected from server.py)
domain_service: DomainService = None
plan_service = None

def init_domain_service(service: DomainService):
    """Initialize domain service"""
    global domain_service
    domain_service = service


def init_plan_service(service):
    global plan_service
    plan_service = service


@router.post("/domains/{domain_id}/subdomains")
async def create_subdomain(domain_id: str, request: CreateSubdomainRequest, current_user: dict = Depends(get_current_user)):
    """Create subdomain"""
    try:
        # Verify domain ownership
        await verify_domain_ownership(domain_id, current_user["id"])

        # Plan limit check
        if plan_service:
            limits = await plan_service.get_user_limits(current_user)
            count = await plan_service.subdomains_count(current_user["id"])
            if limits.get("max_subdomains", 1) != -1 and count >= limits["max_subdomains"]:
                raise HTTPException(
                    status_code=403,
                    detail=f"Plan limit reached: maximum {limits['max_subdomains']} subdomains. Upgrade to add more.",
                )

        result = await domain_service.create_subdomain(domain_id, request.subdomain)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/domains/{domain_id}/subdomains")
async def get_subdomains(domain_id: str, current_user: dict = Depends(get_current_user)):
    """List subdomains for domain"""
    # Verify domain ownership
    await verify_domain_ownership(domain_id, current_user["id"])
    
    subdomains = await db.subdomains.find(
        {"domain_id": domain_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(None)
    return subdomains

@router.delete("/subdomains/{subdomain_id}")
async def delete_subdomain(subdomain_id: str, current_user: dict = Depends(get_current_user)):
    """Delete subdomain"""
    # Get subdomain and verify parent domain ownership
    subdomain = await db.subdomains.find_one({"id": subdomain_id}, {"_id": 0})
    if not subdomain:
        raise HTTPException(status_code=404, detail="Subdomain not found")
    
    # Verify parent domain ownership
    await verify_domain_ownership(subdomain["domain_id"], current_user["id"])
    
    # Check if subdomain has inboxes
    inbox_count = await db.inboxes.count_documents({"subdomain_id": subdomain_id})
    if inbox_count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete subdomain with existing inboxes")
    
    await db.subdomains.delete_one({"id": subdomain_id})
    return {"message": "Subdomain deleted"}
