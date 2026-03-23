import json
import struct
from copy import deepcopy
from pathlib import Path

SUPPORTED_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"
}

PROJECT_STATE_FILENAME = "annotation_state.json"
COCO_EXPORT_FILENAME = "coco_export.json"


def is_supported_image(file_path: Path) -> bool:
    return file_path.is_file() and file_path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


def get_png_size(file_path: Path):
    with file_path.open("rb") as f:
        header = f.read(24)
    if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = struct.unpack(">II", header[16:24])
        return int(width), int(height)
    return 0, 0


def get_gif_size(file_path: Path):
    with file_path.open("rb") as f:
        header = f.read(10)
    if len(header) >= 10 and header[:6] in (b"GIF87a", b"GIF89a"):
        width, height = struct.unpack("<HH", header[6:10])
        return int(width), int(height)
    return 0, 0


def get_bmp_size(file_path: Path):
    with file_path.open("rb") as f:
        header = f.read(26)
    if len(header) >= 26 and header[:2] == b"BM":
        width, height = struct.unpack("<II", header[18:26])
        return int(width), int(height)
    return 0, 0


def get_jpeg_size(file_path: Path):
    with file_path.open("rb") as f:
        data = f.read()

    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return 0, 0

    index = 2
    while index < len(data):
        if data[index] != 0xFF:
            index += 1
            continue

        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break

        marker = data[index]
        index += 1

        if marker in (0xD8, 0xD9):
            continue

        if index + 2 > len(data):
            break

        segment_length = struct.unpack(">H", data[index:index + 2])[0]
        if segment_length < 2 or index + segment_length > len(data):
            break

        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if index + 7 <= len(data):
                height = struct.unpack(">H", data[index + 3:index + 5])[0]
                width = struct.unpack(">H", data[index + 5:index + 7])[0]
                return int(width), int(height)

        index += segment_length

    return 0, 0


def get_webp_size(file_path: Path):
    with file_path.open("rb") as f:
        header = f.read(64)

    if len(header) < 30 or header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        return 0, 0

    chunk_type = header[12:16]

    if chunk_type == b"VP8 ":
        if len(header) >= 30:
            width = struct.unpack("<H", header[26:28])[0] & 0x3FFF
            height = struct.unpack("<H", header[28:30])[0] & 0x3FFF
            return int(width), int(height)

    if chunk_type == b"VP8L":
        if len(header) >= 25:
            b0, b1, b2, b3 = header[21:25]
            width = 1 + (((b1 & 0x3F) << 8) | b0)
            height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
            return int(width), int(height)

    if chunk_type == b"VP8X":
        if len(header) >= 30:
            width = 1 + int.from_bytes(header[24:27], "little")
            height = 1 + int.from_bytes(header[27:30], "little")
            return int(width), int(height)

    return 0, 0


def get_image_size(file_path: Path):
    ext = file_path.suffix.lower()

    try:
        if ext == ".png":
            return get_png_size(file_path)
        if ext in {".jpg", ".jpeg"}:
            return get_jpeg_size(file_path)
        if ext == ".bmp":
            return get_bmp_size(file_path)
        if ext == ".gif":
            return get_gif_size(file_path)
        if ext == ".webp":
            return get_webp_size(file_path)
    except Exception:
        return 0, 0

    return 0, 0


def scan_images(image_dir: str):
    if not image_dir:
        return []

    root = Path(image_dir)
    if not root.exists() or not root.is_dir():
        return []

    image_files = []
    for file_path in root.rglob("*"):
        if is_supported_image(file_path):
            relative_path = file_path.relative_to(root).as_posix()
            width, height = get_image_size(file_path)
            image_files.append({
                "name": file_path.name,
                "relative_path": relative_path,
                "absolute_path": str(file_path.resolve()),
                "url": f"/image/{relative_path}",
                "width": width,
                "height": height
            })

    image_files.sort(key=lambda item: item["relative_path"].lower())
    return image_files


def get_project_state_path(output_dir: str) -> Path:
    output_root = Path(output_dir) if output_dir else Path(".")
    output_root.mkdir(parents=True, exist_ok=True)
    return output_root / PROJECT_STATE_FILENAME


def load_project_state(output_dir: str):
    state_path = get_project_state_path(output_dir)

    if not state_path.exists():
        return {
            "version": 1,
            "categories": [],
            "images": {}
        }

    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "version": 1,
            "categories": [],
            "images": {}
        }

    if not isinstance(data, dict):
        return {
            "version": 1,
            "categories": [],
            "images": {}
        }

    data.setdefault("version", 1)
    data.setdefault("categories", [])
    data.setdefault("images", {})

    if not isinstance(data["categories"], list):
        data["categories"] = []
    if not isinstance(data["images"], dict):
        data["images"] = {}

    return data


def save_project_state(output_dir: str, project_state: dict):
    state_path = get_project_state_path(output_dir)
    state_path.write_text(
        json.dumps(project_state, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def normalize_annotation(annotation: dict):
    if not isinstance(annotation, dict):
        raise ValueError("annotation 必须为对象")

    anno_id = int(annotation.get("anno_id"))
    category_id = int(annotation.get("category_id"))
    category_name = str(annotation.get("category_name", "")).strip()
    bbox = annotation.get("bbox")
    source = str(annotation.get("source", "manual")).strip() or "manual"

    if not category_name:
        raise ValueError("annotation.category_name 不能为空")

    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError("annotation.bbox 必须为长度为 4 的数组")

    x1, y1, x2, y2 = [float(v) for v in bbox]

    if x2 <= x1 or y2 <= y1:
        raise ValueError("annotation.bbox 非法，必须满足 x2>x1 且 y2>y1")

    return {
        "anno_id": anno_id,
        "category_id": category_id,
        "category_name": category_name,
        "bbox": [x1, y1, x2, y2],
        "source": source
    }


def normalize_temporary_annotation(annotation: dict):
    if not isinstance(annotation, dict):
        raise ValueError("temporary_annotation 必须为对象")

    temporary_id = int(annotation.get("temporary_id"))
    label = str(annotation.get("label", "")).strip()
    category_id = int(annotation.get("category_id"))
    category_name = str(annotation.get("category_name", "")).strip()
    score = float(annotation.get("score", 0))
    bbox = annotation.get("bbox")
    source = str(annotation.get("source", "auto")).strip() or "auto"

    if not label:
        label = category_name

    if not category_name:
        raise ValueError("temporary_annotation.category_name 不能为空")

    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError("temporary_annotation.bbox 必须为长度为 4 的数组")

    x1, y1, x2, y2 = [float(v) for v in bbox]

    if x2 <= x1 or y2 <= y1:
        raise ValueError("temporary_annotation.bbox 非法，必须满足 x2>x1 且 y2>y1")

    return {
        "temporary_id": temporary_id,
        "label": label,
        "category_id": category_id,
        "category_name": category_name,
        "score": score,
        "bbox": [x1, y1, x2, y2],
        "source": source
    }


def normalize_single_image_state(image_state: dict):
    if not isinstance(image_state, dict):
        raise ValueError("image_state 必须为对象")

    image_id = int(image_state.get("image_id"))
    file_name = str(image_state.get("file_name", "")).strip()
    width = int(image_state.get("width", 0) or 0)
    height = int(image_state.get("height", 0) or 0)
    annotations = image_state.get("annotations", [])
    temporary_annotations = image_state.get("temporary_annotations", [])

    if not file_name:
        raise ValueError("image_state.file_name 不能为空")

    if width < 0 or height < 0:
        raise ValueError("image_state.width/height 不能小于 0")

    if not isinstance(annotations, list):
        raise ValueError("image_state.annotations 必须为数组")

    if not isinstance(temporary_annotations, list):
        raise ValueError("image_state.temporary_annotations 必须为数组")

    normalized_annotations = [normalize_annotation(item) for item in annotations]
    normalized_annotations.sort(key=lambda item: item["anno_id"])

    normalized_temporary_annotations = [normalize_temporary_annotation(item) for item in temporary_annotations]
    normalized_temporary_annotations.sort(key=lambda item: item["temporary_id"])

    return {
        "image_id": image_id,
        "file_name": file_name,
        "width": width,
        "height": height,
        "annotations": normalized_annotations,
        "temporary_annotations": normalized_temporary_annotations
    }


def normalize_project_state(project_state: dict):
    if not isinstance(project_state, dict):
        raise ValueError("project_state 必须为对象")

    version = int(project_state.get("version", 1))
    categories = project_state.get("categories", [])
    images = project_state.get("images", {})

    if not isinstance(categories, list):
        raise ValueError("project_state.categories 必须为数组")
    if not isinstance(images, dict):
        raise ValueError("project_state.images 必须为对象")

    normalized_images = {}
    for relative_path, image_state in images.items():
        normalized_images[str(relative_path)] = normalize_single_image_state(image_state)

    return {
        "version": version,
        "categories": deepcopy(categories),
        "images": normalized_images
    }


def build_image_states(images, image_id_start: int, existing_state: dict):
    existing_images = existing_state.get("images", {}) if isinstance(existing_state, dict) else {}
    result = {}

    for index, image_item in enumerate(images):
        relative_path = image_item["relative_path"]
        file_name = image_item["name"]
        image_id = int(image_id_start) + index
        width = int(image_item.get("width", 0) or 0)
        height = int(image_item.get("height", 0) or 0)

        if relative_path in existing_images and isinstance(existing_images[relative_path], dict):
            raw_state = deepcopy(existing_images[relative_path])
            raw_state["image_id"] = image_id
            raw_state["file_name"] = file_name
            raw_state["width"] = width or int(raw_state.get("width", 0) or 0)
            raw_state["height"] = height or int(raw_state.get("height", 0) or 0)
            raw_state.setdefault("annotations", [])
            raw_state.setdefault("temporary_annotations", [])
            try:
                normalized_state = normalize_single_image_state(raw_state)
            except Exception:
                normalized_state = {
                    "image_id": image_id,
                    "file_name": file_name,
                    "width": width,
                    "height": height,
                    "annotations": [],
                    "temporary_annotations": []
                }
        else:
            normalized_state = {
                "image_id": image_id,
                "file_name": file_name,
                "width": width,
                "height": height,
                "annotations": [],
                "temporary_annotations": []
            }

        result[relative_path] = normalized_state

    return result


def compute_next_anno_id(image_states, annotation_id_start: int):
    max_anno_id = int(annotation_id_start) - 1

    if isinstance(image_states, dict):
        iterable = image_states.values()
    else:
        iterable = []

    for image_state in iterable:
        annotations = image_state.get("annotations", []) if isinstance(image_state, dict) else []
        for ann in annotations:
            try:
                ann_id = int(ann.get("anno_id"))
                if ann_id > max_anno_id:
                    max_anno_id = ann_id
            except Exception:
                continue

    return max_anno_id + 1


def build_coco_export(project_state: dict, categories: list):
    normalized_state = normalize_project_state(project_state)
    images_map = normalized_state.get("images", {})

    coco_images = []
    coco_annotations = []
    coco_categories = []

    for category in categories:
        coco_categories.append({
            "id": int(category["id"]),
            "name": str(category["name"])
        })

    for _, image_state in sorted(images_map.items(), key=lambda item: item[1]["image_id"]):
        coco_images.append({
            "id": int(image_state["image_id"]),
            "file_name": str(image_state["file_name"]),
            "width": int(image_state.get("width", 0) or 0),
            "height": int(image_state.get("height", 0) or 0)
        })

        for ann in image_state.get("annotations", []):
            if ann.get("source") != "manual":
                continue

            x1, y1, x2, y2 = ann["bbox"]
            w = x2 - x1
            h = y2 - y1

            if w <= 0 or h <= 0:
                continue

            coco_annotations.append({
                "id": int(ann["anno_id"]),
                "image_id": int(image_state["image_id"]),
                "category_id": int(ann["category_id"]),
                "bbox": [float(x1), float(y1), float(w), float(h)],
                "area": float(w * h),
                "iscrowd": 0
            })

    return {
        "images": coco_images,
        "annotations": coco_annotations,
        "categories": coco_categories
    }


def save_coco_export_file(output_dir: str, coco_data: dict) -> Path:
    output_root = Path(output_dir) if output_dir else Path(".")
    output_root.mkdir(parents=True, exist_ok=True)
    export_path = output_root / COCO_EXPORT_FILENAME
    export_path.write_text(
        json.dumps(coco_data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    return export_path