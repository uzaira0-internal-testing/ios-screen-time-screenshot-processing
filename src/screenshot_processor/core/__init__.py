from __future__ import annotations

from .callbacks import CancellationCheck, IssueCallback, LogCallback, ProgressCallback
from .config import (
    ImageProcessingConfig,
    OCRConfig,
    OutputConfig,
    ProcessorConfig,
    ThresholdConfig,
)
from .exceptions import (
    ConfigurationError,
    GridDetectionError,
    ImageProcessingError,
    OCRError,
    ScreenshotProcessorError,
    ValidationError,
)
from .models import (
    BaseRow,
    BatteryRow,
    BlockingIssue,
    FolderProcessingResults,
    GraphDetectionIssue,
    ImageType,
    Issue,
    LineExtractionMode,
    NonBlockingIssue,
    PageMarkerWord,
    PageType,
    ProcessingResult,
    ScreenTimeRow,
    TitleMissingIssue,
    TotalIssue,
    TotalNotFoundIssue,
    TotalOverestimationLargeIssue,
    TotalOverestimationSmallIssue,
    TotalParseErrorIssue,
    TotalUnderestimationLargeIssue,
    TotalUnderestimationSmallIssue,
)
from .ocr_engines import PaddleOCREngine, TesseractOCREngine
from .ocr_factory import OCREngineFactory, OCREngineType
from .ocr_protocol import IOCREngine, OCREngineError, OCREngineNotAvailableError, OCRResult
from .processing_pipeline import ProcessingPipeline
from .processor import ScreenshotProcessor
from .queue_manager import QueueManager, QueueStatistics
from .queue_models import ProcessingMetadata, ProcessingMethod, ProcessingTag, ScreenshotQueue

__all__ = [
    # Processor
    "ScreenshotProcessor",
    "ProcessingPipeline",
    # Config
    "ProcessorConfig",
    "ImageProcessingConfig",
    "OCRConfig",
    "OutputConfig",
    "ThresholdConfig",
    # Callbacks
    "ProgressCallback",
    "IssueCallback",
    "CancellationCheck",
    "LogCallback",
    # Exceptions
    "ScreenshotProcessorError",
    "ImageProcessingError",
    "OCRError",
    "GridDetectionError",
    "ConfigurationError",
    "ValidationError",
    # OCR
    "IOCREngine",
    "OCRResult",
    "OCREngineError",
    "OCREngineNotAvailableError",
    "OCREngineFactory",
    "OCREngineType",
    "TesseractOCREngine",
    "PaddleOCREngine",
    # Queue System
    "ProcessingMetadata",
    "ProcessingMethod",
    "ProcessingTag",
    "ScreenshotQueue",
    "QueueManager",
    "QueueStatistics",
    # Enums
    "ImageType",
    "LineExtractionMode",
    "PageType",
    "PageMarkerWord",
    # Models
    "BaseRow",
    "BatteryRow",
    "ScreenTimeRow",
    "Issue",
    "BlockingIssue",
    "NonBlockingIssue",
    "GraphDetectionIssue",
    "TitleMissingIssue",
    "TotalIssue",
    "TotalNotFoundIssue",
    "TotalParseErrorIssue",
    "TotalUnderestimationSmallIssue",
    "TotalUnderestimationLargeIssue",
    "TotalOverestimationSmallIssue",
    "TotalOverestimationLargeIssue",
    "ProcessingResult",
    "FolderProcessingResults",
]
