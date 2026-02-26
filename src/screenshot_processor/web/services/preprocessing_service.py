"""Backward-compatible facade — delegates to preprocessing/ subpackage.

All public symbols are re-exported so existing imports continue to work:
    from screenshot_processor.web.services.preprocessing_service import detect_device
"""

from screenshot_processor.web.services.preprocessing.device_and_crop import *  # noqa: F401, F403
from screenshot_processor.web.services.preprocessing.phi import *  # noqa: F401, F403
from screenshot_processor.web.services.preprocessing.pipeline import *  # noqa: F401, F403
