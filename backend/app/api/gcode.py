from fastapi import APIRouter, Depends, File, UploadFile

from app.deps import get_current_user
from app.models import User
from app.schemas.print_job import GcodeParseResult
from app.services.gcode_parser import parse_gcode

router = APIRouter(prefix="/gcode", tags=["gcode"])


@router.post("/parse", response_model=GcodeParseResult)
async def parse(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    """Парсит gcode и возвращает метаданные. Исходный файл НЕ сохраняется."""
    content = await file.read()
    return parse_gcode(content, file.filename or "upload.gcode")
