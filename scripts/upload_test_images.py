#!/usr/bin/env python3
"""Quick script to upload test images to screenshot-annotator.

Usage:
    python upload_test_images.py --api-key YOUR_API_KEY --source-dir /path/to/screenshots

Or set environment variables:
    export UPLOAD_API_KEY=your_key
    python upload_test_images.py
"""

import argparse
import base64
import hashlib
import os
import sys
from pathlib import Path

import httpx

# Default configuration
DEFAULT_BASE_URL = "http://cnrc-deni-p001.cnrc.bcm.edu/ios-screen-time-screenshot-processing/api/v1"
DEFAULT_SOURCE_DIR = r"W:\Projects\TECH Study\Data\Screenshot Data\Screenshot Raw Data\Screen Time Screenshots"


def upload_screenshot(
    base_url: str,
    api_key: str,
    image_bytes: bytes,
    participant_id: str,
    group_id: str,
) -> dict:
    """Upload a single screenshot."""
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    sha256 = hashlib.sha256(image_bytes).hexdigest()

    payload = {
        "screenshot": image_b64,
        "participant_id": participant_id,
        "group_id": group_id,
        "image_type": "screen_time",
        "sha256": sha256,
    }

    response = httpx.post(
        f"{base_url}/screenshots/upload",
        json=payload,
        headers={"X-API-Key": api_key},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def extract_participant_id(file_path: Path) -> str:
    """Extract participant ID from file path."""
    import re

    path_str = str(file_path)
    match = re.search(r"P1-(\d{4})(?:-[A-Z])?", path_str)
    if match:
        number = match.group(1)
        return f"P1-{number}-A"
    return "P1-0000-A"


def main():
    parser = argparse.ArgumentParser(description="Upload test images to screenshot-annotator")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("UPLOAD_API_KEY"),
        help="API key for uploads (or set UPLOAD_API_KEY env var)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"Base URL for API (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--source-dir",
        default=DEFAULT_SOURCE_DIR,
        help="Directory containing screenshots",
    )
    parser.add_argument(
        "--group-id",
        default="TECH-iOS-20260110",
        help="Group ID for uploads",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Number of images to upload (default: 10)",
    )
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: API key required. Use --api-key or set UPLOAD_API_KEY env var")
        sys.exit(1)

    source_dir = Path(args.source_dir)
    if not source_dir.exists():
        print(f"ERROR: Source directory not found: {source_dir}")
        sys.exit(1)

    # Find image files
    files = []
    for ext in ["*.png", "*.PNG", "*.jpg", "*.JPG", "*.jpeg", "*.JPEG"]:
        files.extend(source_dir.rglob(ext))
        if len(files) >= args.count:
            break

    files = files[: args.count]
    print(f"Found {len(files)} files to upload")

    if not files:
        print("No image files found!")
        sys.exit(1)

    success_count = 0
    for i, file_path in enumerate(files, 1):
        participant_id = extract_participant_id(file_path)
        print(f"[{i}/{len(files)}] Uploading {file_path.name} as {participant_id}...")

        try:
            result = upload_screenshot(
                base_url=args.base_url,
                api_key=args.api_key,
                image_bytes=file_path.read_bytes(),
                participant_id=participant_id,
                group_id=args.group_id,
            )
            print(f"  -> Success: screenshot_id={result.get('screenshot_id')}")
            success_count += 1
        except httpx.HTTPStatusError as e:
            print(f"  -> HTTP Error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            print(f"  -> Error: {e}")

    print(f"\nDone! Uploaded {success_count}/{len(files)} images")


if __name__ == "__main__":
    main()
