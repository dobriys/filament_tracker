from fastapi import APIRouter

from app.api import (
    auth,
    users,
    filament_profiles,
    locations,
    spools,
    printers,
    slots,
    gcode,
    print_jobs,
    backup,
    settings,
    dashboard,
    catalog,
    diagnostics,
    environment,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(filament_profiles.router)
api_router.include_router(locations.router)
api_router.include_router(spools.router)
api_router.include_router(printers.router)
api_router.include_router(slots.router)
api_router.include_router(gcode.router)
api_router.include_router(print_jobs.router)
api_router.include_router(backup.router)
api_router.include_router(settings.router)
api_router.include_router(dashboard.router)
api_router.include_router(catalog.router)
api_router.include_router(diagnostics.router)
api_router.include_router(environment.router)
