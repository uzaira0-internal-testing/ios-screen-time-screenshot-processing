"""OCR Engine Provider for Dependency Injection.

This module provides a DI-compatible way to obtain OCR engines,
replacing the module-level lru_cache singleton pattern.

Usage:
    # Default usage (same as before)
    provider = DefaultOCREngineProvider()
    engine = provider.get_engine()

    # For testing, inject a mock
    mock_engine = MockOCREngine()
    provider = DefaultOCREngineProvider(engine=mock_engine)

    # Or use the global provider
    set_ocr_engine_provider(mock_provider)
    engine = get_ocr_engine()
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from .config import OCRConfig
    from .ocr_protocol import IOCREngine

logger = logging.getLogger(__name__)


class IOCREngineProvider(Protocol):
    """Protocol for OCR engine providers."""

    def get_engine(self) -> IOCREngine:
        """Get an OCR engine instance."""
        ...


class DefaultOCREngineProvider:
    """Default OCR engine provider using HybridOCREngine.

    Uses lazy initialization and caches the engine instance.
    Supports injection of pre-configured engines for testing.
    """

    def __init__(
        self,
        config: OCRConfig | None = None,
        engine: IOCREngine | None = None,
    ):
        """Initialize the provider.

        Args:
            config: OCR configuration. If None, uses defaults from settings.
            engine: Pre-configured engine to use. If provided, config is ignored.
        """
        self._config = config
        self._engine = engine
        self._initialized = engine is not None

    def get_engine(self) -> IOCREngine:
        """Get or create an OCR engine instance."""
        if not self._initialized:
            self._engine = self._create_engine()
            self._initialized = True
        return self._engine  # type: ignore

    def _create_engine(self) -> IOCREngine:
        """Create a new OCR engine based on config."""
        from .config import get_hybrid_ocr_config
        from .ocr_engines import HybridOCREngine

        config = self._config or get_hybrid_ocr_config()

        engine = HybridOCREngine(
            hunyuan_url=config.hunyuan_url,
            paddleocr_url=config.paddleocr_url,
            hunyuan_timeout=config.hunyuan_timeout,
            paddleocr_timeout=config.paddleocr_timeout,
            enable_hunyuan=config.hybrid_enable_hunyuan,
            enable_paddleocr=config.hybrid_enable_paddleocr,
            enable_tesseract=config.hybrid_enable_tesseract,
        )
        logger.info(f"Initialized HybridOCREngine: {engine.get_available_engines()}")
        return engine


# =============================================================================
# Global Provider (for dependency injection and testing)
# =============================================================================

_global_provider: IOCREngineProvider | None = None


def set_ocr_engine_provider(provider: IOCREngineProvider | None) -> None:
    """Set the global OCR engine provider.

    Call with None to reset to default behavior.
    Useful for testing to inject mock engines.
    """
    global _global_provider
    _global_provider = provider
    # Clear the cached engine when provider changes
    _get_default_engine.cache_clear()


def get_ocr_engine_provider() -> IOCREngineProvider:
    """Get the current OCR engine provider."""
    global _global_provider
    if _global_provider is not None:
        return _global_provider
    return DefaultOCREngineProvider()


@lru_cache(maxsize=1)
def _get_default_engine() -> IOCREngine:
    """Get the default OCR engine (cached singleton)."""
    return get_ocr_engine_provider().get_engine()


def get_ocr_engine() -> IOCREngine:
    """Get an OCR engine instance.

    Uses the global provider if set, otherwise creates a default provider.
    The engine is cached for the lifetime of the application.

    Returns:
        OCR engine instance
    """
    return _get_default_engine()


def reset_ocr_engine() -> None:
    """Reset the cached OCR engine.

    Useful for testing or when configuration changes.
    """
    _get_default_engine.cache_clear()
