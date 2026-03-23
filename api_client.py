from pathlib import Path
from typing import Any, Dict

import requests


def call_inference_api(
    api_url: str,
    token: str,
    request_type: str,
    image_path: str,
    timeout: int = 120
) -> Dict[str, Any]:
    api_url = str(api_url or "").strip()
    token = str(token or "").strip()
    request_type = str(request_type or "").strip().lower()
    image_path = str(image_path or "").strip()

    if not api_url:
        raise ValueError("未配置自动标注 API URL")
    if request_type not in {"image", "path"}:
        raise ValueError("自动标注请求类型必须为 image 或 path")
    if not image_path:
        raise ValueError("缺少图像路径")

    if request_type == "image":
        file_path = Path(image_path)
        if not file_path.exists() or not file_path.is_file():
            raise ValueError("图像文件不存在，无法上传图像内容")

        with file_path.open("rb") as f:
            files = {
                "image": (file_path.name, f, "application/octet-stream")
            }
            data = {
                "token": token,
                "type": "image"
            }
            response = requests.post(
                api_url,
                data=data,
                files=files,
                timeout=timeout
            )
    else:
        payload = {
            "token": token,
            "type": "path",
            "path": image_path
        }
        response = requests.post(
            api_url,
            json=payload,
            timeout=timeout
        )

    response.raise_for_status()
    return response.json()