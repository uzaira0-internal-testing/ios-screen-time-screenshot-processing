"""Repository layer for database access.

The repository pattern provides an abstraction over data access logic,
separating query construction from route handlers.

Usage with FastAPI DI:
    from screenshot_processor.web.repositories import AnnotationRepo, ScreenshotRepo

    @router.get("/annotations/{id}")
    async def get_annotation(id: int, repo: AnnotationRepo):
        return await repo.get_by_id(id)
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from screenshot_processor.web.database import get_db

from .annotation_repository import AnnotationRepository
from .consensus_repository import ConsensusRepository
from .screenshot_repository import ScreenshotRepository


# =============================================================================
# Dependency Injection Factories
# =============================================================================


def get_screenshot_repo(
    db: AsyncSession = Depends(get_db),
) -> ScreenshotRepository:
    """FastAPI dependency for ScreenshotRepository."""
    return ScreenshotRepository(db)


def get_annotation_repo(
    db: AsyncSession = Depends(get_db),
) -> AnnotationRepository:
    """FastAPI dependency for AnnotationRepository."""
    return AnnotationRepository(db)


def get_consensus_repo(
    db: AsyncSession = Depends(get_db),
) -> ConsensusRepository:
    """FastAPI dependency for ConsensusRepository."""
    return ConsensusRepository(db)


# =============================================================================
# Type Aliases for Route Parameters
# =============================================================================

ScreenshotRepo = Annotated[ScreenshotRepository, Depends(get_screenshot_repo)]
AnnotationRepo = Annotated[AnnotationRepository, Depends(get_annotation_repo)]
ConsensusRepo = Annotated[ConsensusRepository, Depends(get_consensus_repo)]


__all__ = [
    # Repository classes
    "ScreenshotRepository",
    "AnnotationRepository",
    "ConsensusRepository",
    # DI factories
    "get_screenshot_repo",
    "get_annotation_repo",
    "get_consensus_repo",
    # Type aliases for route parameters
    "ScreenshotRepo",
    "AnnotationRepo",
    "ConsensusRepo",
]
