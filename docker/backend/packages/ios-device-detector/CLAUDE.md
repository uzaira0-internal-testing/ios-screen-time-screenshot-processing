# iOS Device Detector

## Overview

This package detects iOS device models (iPhone, iPad) from image dimensions, aspect ratios, and optional EXIF metadata. It's used to identify the source device of screenshots for proper processing in the research pipeline.

## Architecture

```
ios_device_detector/
├── core/              # Core detection logic
│   ├── detector.py    # Main detector class
│   ├── types.py       # Type definitions
│   └── exceptions.py  # Custom exceptions
├── profiles/          # Device profile definitions
│   ├── iphone.py      # iPhone models and dimensions
│   ├── ipad.py        # iPad models and dimensions
│   └── registry.py    # Profile registry
├── web/               # FastAPI service (optional)
│   ├── main.py        # App factory
│   ├── routes.py      # API endpoints
│   └── schemas.py     # Pydantic schemas
└── client/            # HTTP client (optional)
    └── client.py      # Sync/async client
```

## Key Patterns

### Detection Flow

1. Extract dimensions from image (width, height)
2. Calculate aspect ratio
3. Match against known device profiles
4. Return best match with confidence score

### Device Profiles

Each device profile contains:
- Model name and identifier
- Screen resolution (points and pixels)
- Scale factor (1x, 2x, 3x)
- Expected screenshot dimensions
- Aspect ratio

### Confidence Scoring

- Exact match: 1.0
- Within tolerance: 0.8-0.99 (based on deviation)
- Aspect ratio match only: 0.5-0.7
- No match: 0.0

## Usage

### Library Interface

```python
from ios_device_detector import DeviceDetector, DetectionResult

detector = DeviceDetector()

# From dimensions
result = detector.detect_from_dimensions(1170, 2532)
print(f"Device: {result.device_model}")  # iPhone 12 Pro
print(f"Confidence: {result.confidence}")

# From image file (requires pillow)
result = detector.detect_from_file("screenshot.png")

# Check if iPad vs iPhone
if result.is_ipad:
    print("This is an iPad screenshot")
```

### Service Interface

```python
from ios_device_detector.client import DeviceDetectorClient

with DeviceDetectorClient("http://localhost:8000") as client:
    result = client.detect(width=1170, height=2532)
```

## Device Database

The package includes comprehensive device profiles for:
- All iPhone models (6 through 15 series)
- All iPad models (Air, Pro, Mini, Standard)
- Both portrait and landscape orientations
- All scale factors (1x, 2x, 3x)

## Dependencies

- **pydantic**: Data validation
- **pillow** (optional): Image dimension extraction
- **fastapi** (optional): HTTP service
- **httpx** (optional): HTTP client
