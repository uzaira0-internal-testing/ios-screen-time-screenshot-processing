"""Repository for Consensus database operations."""

from __future__ import annotations


from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from screenshot_processor.web.database.models import (
    Annotation,
    ConsensusResult,
    Group,
    Screenshot,
    User,
)


class ConsensusRepository:
    """Repository for Consensus and verification tier operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_consensus_result(self, screenshot_id: int) -> ConsensusResult | None:
        """Get consensus result for a screenshot."""
        result = await self.db.execute(select(ConsensusResult).where(ConsensusResult.screenshot_id == screenshot_id))
        return result.scalar_one_or_none()

    async def get_or_create_consensus_result(self, screenshot_id: int) -> ConsensusResult:
        """Get or create consensus result for a screenshot."""
        existing = await self.get_consensus_result(screenshot_id)
        if existing:
            return existing

        new_result = ConsensusResult(screenshot_id=screenshot_id)
        self.db.add(new_result)
        await self.db.flush()
        return new_result

    async def update_consensus_result(
        self,
        screenshot_id: int,
        has_consensus: bool,
        consensus_values: dict | None = None,
        disagreement_count: int = 0,
    ) -> ConsensusResult:
        """Update or create consensus result."""
        result = await self.get_or_create_consensus_result(screenshot_id)
        result.has_consensus = has_consensus
        result.consensus_values = consensus_values
        result.disagreement_count = disagreement_count
        return result

    async def get_all_groups(self) -> list[Group]:
        """Get all groups ordered by name."""
        result = await self.db.execute(select(Group).order_by(Group.name))
        return list(result.scalars().all())

    async def get_verified_screenshots_in_group(self, group_id: str) -> list[Screenshot]:
        """Get all verified screenshots in a group with their annotations."""
        # Note: JSON columns can have SQL NULL or JSON null (literal "null" string)
        result = await self.db.execute(
            select(Screenshot)
            .options(selectinload(Screenshot.annotations))
            .where(
                Screenshot.group_id == group_id,
                Screenshot.verified_by_user_ids.isnot(None),
                cast(Screenshot.verified_by_user_ids, String) != "null",
                cast(Screenshot.verified_by_user_ids, String) != "[]",
            )
            .order_by(Screenshot.screenshot_date, Screenshot.id)
        )
        return list(result.scalars().all())

    async def get_group_screenshot_count(self, group_id: str) -> int:
        """Get total screenshot count for a group."""
        result = await self.db.execute(select(func.count(Screenshot.id)).where(Screenshot.group_id == group_id))
        return result.scalar_one()

    async def get_screenshot_with_annotations(self, screenshot_id: int) -> Screenshot | None:
        """Get screenshot with annotations and users eagerly loaded."""
        result = await self.db.execute(
            select(Screenshot)
            .options(
                selectinload(Screenshot.annotations).selectinload(Annotation.user),
                selectinload(Screenshot.resolved_by),
            )
            .where(Screenshot.id == screenshot_id)
        )
        return result.scalar_one_or_none()

    async def get_users_by_ids(self, user_ids: list[int]) -> list:
        """Get users by their IDs."""
        result = await self.db.execute(select(User).where(User.id.in_(user_ids)))
        return list(result.scalars().all())

    async def get_group_by_id(self, group_id: str) -> Group | None:
        """Get group by ID."""
        result = await self.db.execute(select(Group).where(Group.id == group_id))
        return result.scalar_one_or_none()

    async def get_screenshot_with_annotations_for_update(self, screenshot_id: int) -> Screenshot | None:
        """Get screenshot with annotations eagerly loaded and row lock.

        Used by consensus analysis to prevent race conditions when
        multiple annotations are submitted concurrently.
        """
        result = await self.db.execute(
            select(Screenshot)
            .options(selectinload(Screenshot.annotations))
            .where(Screenshot.id == screenshot_id)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def get_consensus_counts(self) -> dict:
        """Get consensus-related counts for the summary endpoint.

        Returns:
            Dict with total_with_consensus, total_with_disagreements,
            and total_completed counts.
        """
        total_with_consensus_stmt = select(func.count(ConsensusResult.id)).where(
            ConsensusResult.has_consensus == True  # noqa: E712
        )
        result = await self.db.execute(total_with_consensus_stmt)
        total_with_consensus = result.scalar_one()

        total_with_disagreements_stmt = select(func.count(ConsensusResult.id)).where(
            ConsensusResult.has_consensus == False  # noqa: E712
        )
        result = await self.db.execute(total_with_disagreements_stmt)
        total_with_disagreements = result.scalar_one()

        total_annotations_stmt = select(func.count(Screenshot.id)).where(
            Screenshot.current_annotation_count >= Screenshot.target_annotations
        )
        result = await self.db.execute(total_annotations_stmt)
        total_completed = result.scalar_one()

        return {
            "total_with_consensus": total_with_consensus,
            "total_with_disagreements": total_with_disagreements,
            "total_completed": total_completed,
        }

    async def get_consensus_summary_stats(self) -> dict:
        """Get summary statistics for consensus analysis."""
        # Total screenshots
        total_result = await self.db.execute(select(func.count(Screenshot.id)))
        total = total_result.scalar_one()

        # Screenshots with consensus results
        with_consensus_result = await self.db.execute(select(func.count(ConsensusResult.id)))
        with_consensus = with_consensus_result.scalar_one()

        # Screenshots with disagreements
        with_disagreements_result = await self.db.execute(
            select(func.count(ConsensusResult.id)).where(
                ConsensusResult.has_consensus == False  # noqa: E712
            )
        )
        with_disagreements = with_disagreements_result.scalar_one()

        # Total disagreements
        total_disagreements_result = await self.db.execute(select(func.sum(ConsensusResult.disagreement_count)))
        total_disagreements = total_disagreements_result.scalar_one() or 0

        return {
            "total_screenshots": total,
            "screenshots_with_consensus": with_consensus,
            "screenshots_with_disagreements": with_disagreements,
            "total_disagreements": total_disagreements,
            "avg_disagreements_per_screenshot": (
                total_disagreements / with_disagreements if with_disagreements > 0 else 0
            ),
        }
