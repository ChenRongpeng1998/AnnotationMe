import json
from copy import deepcopy
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = BASE_DIR / "user_config.json"

DEFAULT_CONFIG = {
    "image_dir": "",
    "output_dir": str(BASE_DIR / "output"),
    "categories": [
        {"id": 1, "name": "button"},
        {"id": 2, "name": "knob"}
    ],
    "image_id_start": 1,
    "annotation_id_start": 1,
    "bbox_line_width": 2,
    "toolbar_tools": [
        "select",
        "bbox",
        "delete",
        "zoom_in",
        "zoom_out",
        "fit"
    ],
    "auto_annotate_api_url": "",
    "auto_annotate_token": "",
    "auto_annotate_request_type": "path"
}


def ensure_config_file_exists(config_path: Path = DEFAULT_CONFIG_PATH):
    if not config_path.exists():
        config_path.write_text(
            json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )


def load_config(config_path: Path = DEFAULT_CONFIG_PATH):
    ensure_config_file_exists(config_path)

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        data = deepcopy(DEFAULT_CONFIG)
        save_config(data, config_path)

    merged = deepcopy(DEFAULT_CONFIG)
    merged.update(data)

    if not isinstance(merged.get("categories"), list):
        merged["categories"] = deepcopy(DEFAULT_CONFIG["categories"])

    if not isinstance(merged.get("toolbar_tools"), list):
        merged["toolbar_tools"] = deepcopy(DEFAULT_CONFIG["toolbar_tools"])

    request_type = str(merged.get("auto_annotate_request_type", "path")).strip().lower()
    if request_type not in {"image", "path"}:
        merged["auto_annotate_request_type"] = "path"
    else:
        merged["auto_annotate_request_type"] = request_type

    return merged


def save_config(config_data, config_path: Path = DEFAULT_CONFIG_PATH):
    config_path.parent.mkdir(parents=True, exist_ok=True)

    output_dir = config_data.get("output_dir")
    if output_dir:
        Path(output_dir).mkdir(parents=True, exist_ok=True)

    config_path.write_text(
        json.dumps(config_data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def validate_and_normalize_config(raw_config: dict):
    config = deepcopy(DEFAULT_CONFIG)

    image_dir = str(raw_config.get("image_dir", "")).strip()
    output_dir = str(raw_config.get("output_dir", "")).strip()
    categories = raw_config.get("categories", deepcopy(DEFAULT_CONFIG["categories"]))
    image_id_start = raw_config.get("image_id_start", DEFAULT_CONFIG["image_id_start"])
    annotation_id_start = raw_config.get("annotation_id_start", DEFAULT_CONFIG["annotation_id_start"])
    bbox_line_width = raw_config.get("bbox_line_width", DEFAULT_CONFIG["bbox_line_width"])
    toolbar_tools = raw_config.get("toolbar_tools", deepcopy(DEFAULT_CONFIG["toolbar_tools"]))
    auto_annotate_api_url = str(raw_config.get("auto_annotate_api_url", "")).strip()
    auto_annotate_token = str(raw_config.get("auto_annotate_token", "")).strip()
    auto_annotate_request_type = str(raw_config.get("auto_annotate_request_type", "path")).strip().lower()

    if not isinstance(categories, list):
        raise ValueError("categories 必须为 JSON 数组")

    normalized_categories = []
    for item in categories:
        if not isinstance(item, dict):
            raise ValueError("categories 中每一项都必须是对象")
        if "id" not in item or "name" not in item:
            raise ValueError("categories 每一项必须包含 id 和 name")
        normalized_categories.append({
            "id": int(item["id"]),
            "name": str(item["name"]).strip()
        })

    if not isinstance(toolbar_tools, list):
        raise ValueError("toolbar_tools 必须为数组")

    normalized_toolbar_tools = [str(tool).strip() for tool in toolbar_tools if str(tool).strip()]

    try:
        image_id_start = int(image_id_start)
        annotation_id_start = int(annotation_id_start)
        bbox_line_width = int(bbox_line_width)
    except Exception:
        raise ValueError("image_id 起始编号、annotation_id 起始编号、bbox 默认线宽必须为整数")

    if image_id_start < 0:
        raise ValueError("image_id 起始编号不能小于 0")
    if annotation_id_start < 0:
        raise ValueError("annotation_id 起始编号不能小于 0")
    if bbox_line_width <= 0:
        raise ValueError("bbox 默认线宽必须大于 0")

    if auto_annotate_request_type not in {"image", "path"}:
        raise ValueError("自动标注请求类型必须为 image 或 path")

    config["image_dir"] = image_dir
    config["output_dir"] = output_dir
    config["categories"] = normalized_categories
    config["image_id_start"] = image_id_start
    config["annotation_id_start"] = annotation_id_start
    config["bbox_line_width"] = bbox_line_width
    config["toolbar_tools"] = normalized_toolbar_tools
    config["auto_annotate_api_url"] = auto_annotate_api_url
    config["auto_annotate_token"] = auto_annotate_token
    config["auto_annotate_request_type"] = auto_annotate_request_type

    return config