"""LLM configuration and generation routes"""
from fastapi import APIRouter, HTTPException

from database import db
from models import LLMConfig
from services.llm_service import LLMService
from routes.schemas import LLMGenerateRequest

router = APIRouter()

# Initialize service (will be injected from server.py)
llm_service: LLMService = None

def init_llm_service(service: LLMService):
    """Initialize LLM service"""
    global llm_service
    llm_service = service

@router.post("/llm/config")
async def save_llm_config(config: LLMConfig):
    """Save LLM API configuration"""
    await db.llm_configs.update_one(
        {"user_id": config.user_id, "provider": config.provider},
        {"$set": config.model_dump()},
        upsert=True
    )
    return {"message": "LLM configuration saved"}

@router.get("/llm/configs")
async def get_llm_configs(user_id: str):
    """Get all LLM configurations for user"""
    configs = await db.llm_configs.find(
        {"user_id": user_id},
        {"_id": 0, "api_key": 0}
    ).to_list(None)
    return configs

@router.get("/llm/check-config")
async def check_llm_config(user_id: str):
    """Check if user has at least one LLM provider configured with valid API key.
    
    Returns:
        {"configured": bool, "providers": [provider names]}
    
    Used by frontend to validate before showing AI generation options.
    """
    configs = await db.llm_configs.find(
        {"user_id": user_id},
        {"_id": 0, "provider": 1, "api_key": 1}
    ).to_list(None)
    
    # Check if any config has a non-empty API key
    valid_providers = [
        config["provider"] 
        for config in configs 
        if config.get("api_key") and len(config["api_key"].strip()) > 0
    ]
    
    return {
        "configured": len(valid_providers) > 0,
        "providers": valid_providers
    }

@router.post("/llm/generate-template")
async def generate_template(request: LLMGenerateRequest):
    """Generate email template using LLM"""
    try:
        content = await llm_service.generate_text(
            request.user_id, 
            request.provider, 
            request.prompt
        )
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/llm/config/{provider}")
async def delete_llm_config(user_id: str, provider: str):
    """Delete LLM API configuration"""
    await db.llm_configs.delete_one({
        "user_id": user_id,
        "provider": provider
    })
    return {"message": "LLM configuration deleted"}
