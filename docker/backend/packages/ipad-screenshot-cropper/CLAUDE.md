# iPad Screenshot Cropper

**Geometric cropping and device detection for iPad screenshots**

Version: 1.0.0

## Overview

This package provides focused functionality for detecting iPad device types and performing geometric cropping on screenshots. It does NOT handle PHI (Protected Health Information) detection or removal - that's handled by the separate `phi-detector-remover` package.

## Architecture

### Core Components

1. **Device Detection** (`device_profiles.py`)
   - Detects iPad models from image dimensions
   - Supports: iPad Pro 12.9", iPad Pro 11", iPad Air, iPad Mini, iPad Standard
   - Dimension-based matching with configurable tolerance

2. **Geometric Cropping** (`cropper.py`)
   - Crops screenshots to specified dimensions
   - Auto-detects device if not specified
   - Framework-agnostic core logic

3. **Image Patching** (`patch.py`)
   - Handles screenshots shorter than minimum height
   - Adds patch images to top/bottom as needed
   - Uses bundled patch image assets

4. **Configuration** (`config.py`)
   - Dimension configurations for cropping
   - Processing parameters
   - Asset file paths

### Service Components

1. **Web API** (`web/`)
   - FastAPI-based REST service
   - Endpoints for cropping, device detection, health checks
   - OpenAPI/Swagger docs at `/docs`

2. **HTTP Client** (`client/`)
   - Synchronous and async client implementations
   - Type-safe responses using Pydantic models

## Usage

### Library Usage

```python
from ipad_screenshot_cropper import crop_screenshot, detect_device, should_process_image

# Check if image should be processed
check = should_process_image("screenshot.png")
if check.should_process:
    print(f"Should process: {check.reason}")
    
    # Detect device
    device = detect_device("screenshot.png")
    print(f"Device: {device.model.value}")
    
    # Crop screenshot
    result = crop_screenshot("screenshot.png")
    
    # Save cropped image
    import cv2
    cv2.imwrite("cropped.png", result.cropped_image)
else:
    print(f"Skip: {check.reason}")
```

### Advanced Library Usage

```python
from ipad_screenshot_cropper import ScreenshotCropper, CropperConfig

# Custom configuration
config = CropperConfig()
cropper = ScreenshotCropper(config=config)

# Process with callbacks
def log_callback(level, message):
    print(f"[{level}] {message}")

cropper_with_logging = ScreenshotCropper(log_callback=log_callback)
result = cropper_with_logging.crop_screenshot("screenshot.png")
```

### Service Usage

Start the service:

```bash
# Using uvicorn directly
uvicorn ipad_screenshot_cropper.web.main:app --host 0.0.0.0 --port 8000

# Using Python module
python -m uvicorn ipad_screenshot_cropper.web.main:app --host 0.0.0.0 --port 8000

# Using Docker
docker build -t ipad-screenshot-cropper .
docker run -p 8000:8000 ipad-screenshot-cropper
```

### Client Usage

```python
from ipad_screenshot_cropper.client import CropperClient

# Synchronous client
with CropperClient("http://localhost:8000") as client:
    # Check health
    health = client.health()
    print(f"Status: {health.status}")
    
    # Crop screenshot (get JSON)
    response = client.crop_screenshot("screenshot.png")
    print(f"Device: {response.device.model}")
    
    # Crop screenshot (get image bytes)
    image_data = client.crop_screenshot_image("screenshot.png")
    with open("cropped.png", "wb") as f:
        f.write(image_data)
    
    # Detect device
    device_info = client.detect_device("screenshot.png")
    print(f"Supported: {device_info.is_supported}")
    
    # Check if should process
    check = client.should_process("screenshot.png")
    if check.should_process:
        print(f"Process: {check.reason}")

# Async client
import asyncio
from ipad_screenshot_cropper.client import AsyncCropperClient

async def process_screenshot():
    async with AsyncCropperClient("http://localhost:8000") as client:
        response = await client.crop_screenshot("screenshot.png")
        print(f"Device: {response.device.model}")

asyncio.run(process_screenshot())
```

## API Endpoints

### POST /api/v1/crop
Crop an iPad screenshot

**Parameters:**
- `file`: Screenshot image file (multipart/form-data)
- `return_image`: (optional) Return image bytes instead of JSON

**Response (JSON):**
```json
{
  "success": true,
  "device": {
    "model": "iPad Pro 12.9\"",
    "uncropped_width": 1620,
    "uncropped_height": 2160,
    "cropped_width": 990,
    "cropped_height": 2160
  },
  "was_patched": false,
  "original_dimensions": [1620, 2160],
  "cropped_dimensions": [990, 2160],
  "message": "Successfully cropped iPad Pro 12.9\" screenshot"
}
```

**Response (Image):**
PNG image bytes with headers:
- `X-Device-Model`: Detected device model
- `X-Was-Patched`: Whether image was patched
- `X-Original-Dimensions`: Original dimensions (WxH)
- `X-Cropped-Dimensions`: Cropped dimensions (WxH)

### POST /api/v1/detect-device
Detect device type from screenshot

**Parameters:**
- `file`: Screenshot image file

**Response:**
```json
{
  "device": {
    "model": "iPad Pro 12.9\"",
    "uncropped_width": 1620,
    "uncropped_height": 2160,
    "cropped_width": 990,
    "cropped_height": 2160
  },
  "is_supported": true
}
```

### POST /api/v1/should-process
Check if image should be processed

**Parameters:**
- `file`: Screenshot image file

**Response:**
```json
{
  "should_process": true,
  "reason": "Valid iPad screenshot (1620x2160)",
  "device": {
    "model": "iPad Pro 12.9\"",
    "uncropped_width": 1620,
    "uncropped_height": 2160,
    "cropped_width": 990,
    "cropped_height": 2160
  }
}
```

### GET /api/v1/device-profiles
List supported device profiles

**Response:**
```json
{
  "profiles": [
    {
      "model": "iPad Pro 12.9\"",
      "uncropped_dimensions": [1620, 2160],
      "cropped_dimensions": [990, 2160],
      "crop_region": {
        "x": 630,
        "y": 0,
        "width": 1620,
        "height": 2160
      }
    }
  ],
  "count": 5
}
```

### GET /api/v1/health
Health check endpoint

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "assets_loaded": true
}
```

## Installation

```bash
# Core library only
uv pip install ipad-screenshot-cropper

# With web service
uv pip install "ipad-screenshot-cropper[web]"

# With PHI integration (optional)
uv pip install "ipad-screenshot-cropper[phi]"

# Full installation
uv pip install "ipad-screenshot-cropper[full]"
```

## Dependencies

**Core:**
- `opencv-python>=4.5.0` - Image processing
- `Pillow>=9.0.0` - Image manipulation
- `numpy>=1.24.0` - Numerical operations
- `pydantic>=2.0.0` - Data validation

**Web (optional):**
- `fastapi>=0.110.0` - Web framework
- `uvicorn[standard]>=0.27.0` - ASGI server
- `httpx>=0.27.0` - HTTP client
- `python-multipart>=0.0.9` - File upload support

**PHI (optional):**
- `phi-detector-remover` - PHI detection and removal

## Device Profiles

Currently supported iPad models (all use same screenshot dimensions):

| Model | Uncropped Size | Cropped Size | Notes |
|-------|---------------|--------------|-------|
| iPad Pro 12.9" | 1620x2160 | 990x2160 | All generations |
| iPad Pro 11" | 1620x2160 | 990x2160 | |
| iPad Air | 1620x2160 | 990x2160 | |
| iPad Mini | 1620x2160 | 990x2160 | |
| iPad Standard | 1620x2160 | 990x2160 | |

Dimension tolerance: ±10 pixels

## Image Processing Logic

### Should Process Image

Determines if an image should be cropped based on:

1. **Already cropped** (990x2160) → Skip
2. **Landscape orientation** (2160x1620) → Skip
3. **Too small** (< 990x2000) → Skip
4. **Wrong aspect ratio** (not ~1.33) → Skip
5. **Valid iPad screenshot** (1620x2160) → Process

### Cropping Process

1. **Load image** from file, bytes, or numpy array
2. **Detect device** from dimensions (if not specified)
3. **Patch image** if height < 2160 pixels
   - Adds bottom patch for short screenshots
   - Uses bundled patch images
4. **Crop to region** (x=630, y=0, width=1620, height=2160)
5. **Return result** with metadata

## Integration with PHI Detector Remover

This package focuses on geometric operations only. For PHI handling:

```python
from ipad_screenshot_cropper import crop_screenshot
from phi_detector_remover import remove_phi  # Hypothetical

# Step 1: Geometric cropping
crop_result = crop_screenshot("screenshot.png")

# Step 2: PHI removal (separate package)
phi_removed = remove_phi(crop_result.cropped_image)

# Step 3: Save final result
import cv2
cv2.imwrite("final.png", phi_removed)
```

## Configuration

### Default Crop Dimensions
- X offset: 630
- Y offset: 0
- Width: 1620
- Height: 2160

### Dimension Rules
- Uncropped: 1620x2160
- Cropped: 990x2160
- Tolerance: ±10 pixels
- Min size: 990x2000
- Target aspect ratio: 1.333 ±0.1

### Assets
- Bottom patch: `bottom_patch_image.png`
- Top patch: `top_patch_image.png`
- Font: `SF-Pro-Display-Medium.otf`

## Error Handling

### Exception Hierarchy
```
CropperError (base)
├── ConfigurationError
├── ImageProcessingError
├── DeviceDetectionError
├── AssetNotFoundError
└── CancellationError
```

### Common Errors
- **Invalid image**: File cannot be loaded or is corrupted
- **Unsupported device**: Dimensions don't match any known iPad model
- **Asset not found**: Required patch images or fonts missing
- **Processing error**: OpenCV or PIL operation failed

## Testing

```python
# Test device detection
from ipad_screenshot_cropper import detect_device

device = detect_device("test_screenshot.png")
assert device.model.value == "iPad Pro 12.9\""

# Test cropping
from ipad_screenshot_cropper import crop_screenshot

result = crop_screenshot("test_screenshot.png")
assert result.cropped_dimensions == (990, 2160)

# Test should process
from ipad_screenshot_cropper import should_process_image

check = should_process_image("already_cropped.png")
assert not check.should_process
assert "Already cropped" in check.reason
```

## Deployment

### Docker Deployment

```bash
# Build image
docker build -t ipad-screenshot-cropper .

# Run container
docker run -p 8000:8000 ipad-screenshot-cropper

# Health check
curl http://localhost:8000/api/v1/health
```

### Environment Variables

Currently none required. Future versions may support:
- `CROPPER_LOG_LEVEL` - Logging level
- `CROPPER_MAX_IMAGE_SIZE` - Maximum image size in bytes
- `CROPPER_CORS_ORIGINS` - CORS allowed origins

## Dagster Integration

For use in Dagster pipelines:

```python
from dagster import asset
from ipad_screenshot_cropper import ScreenshotCropper

@asset
def cropped_screenshots(context, screenshot_files):
    """Crop iPad screenshots."""
    cropper = ScreenshotCropper()
    results = []
    
    for file_path in screenshot_files:
        check = cropper.should_process_image(file_path)
        if check.should_process:
            result = cropper.crop_screenshot(file_path)
            results.append(result)
            context.log.info(f"Cropped {file_path}: {result.device.model.value}")
        else:
            context.log.info(f"Skipped {file_path}: {check.reason}")
    
    return results
```

## Performance Notes

- Image loading: ~10-50ms per image
- Device detection: <1ms (dimension check only)
- Cropping: ~5-20ms per image
- Patching: +10-30ms if needed

For batch processing, consider parallel execution:

```python
from concurrent.futures import ThreadPoolExecutor
from ipad_screenshot_cropper import ScreenshotCropper

def process_batch(image_paths):
    cropper = ScreenshotCropper()
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(cropper.crop_screenshot, image_paths))
    
    return results
```

## Future Enhancements

1. **Additional device profiles** - iPhone, Android tablets
2. **Batch processing API** - Process multiple images in one request
3. **Custom crop regions** - User-defined crop coordinates
4. **Image format support** - JPEG, WebP, HEIC
5. **Quality settings** - Compression level, format conversion

## Contributing

When modifying this package:

1. **Keep it focused** - Only geometric operations, no PHI logic
2. **Maintain separation** - PHI handling stays in `phi-detector-remover`
3. **Preserve dimensions** - Crop coordinates are tuned for iPad screenshots
4. **Update tests** - Add tests for new device profiles
5. **Document changes** - Update this CLAUDE.md file

## Related Packages

- `phi-detector-remover` - PHI detection and removal (OCR-based)
- `ios-screenshot-cropper` - Original monolithic package (deprecated)

## License

See parent monorepo LICENSE file.
