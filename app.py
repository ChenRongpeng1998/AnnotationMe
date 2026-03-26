# app.py
from copy import deepcopy
from pathlib import Path
from threading import Thread, Lock
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, url_for

from api_client import call_inference_api
from config import load_config, save_config, validate_and_normalize_config
from data_manager import (
    scan_images,
    load_project_state,
    save_project_state,
    build_image_states,
    compute_next_anno_id,
    normalize_project_state,
    build_coco_export,
    save_coco_export_file,
    normalize_single_image_state,
    normalize_temporary_annotation,
)

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent

AUTO_BATCH_LOCK = Lock()
AUTO_BATCH_STATE = {
    "running": False,
    "total": 0,
    "processed": 0,
    "success_count": 0,
    "failed_count": 0,
    "current_image": "",
    "selected_relative_paths": [],
    "logs": [],
}
AUTO_BATCH_PENDING = {}


def append_batch_log(message: str):
    with AUTO_BATCH_LOCK:
        AUTO_BATCH_STATE["logs"].append(message)
        if len(AUTO_BATCH_STATE["logs"]) > 200:
            AUTO_BATCH_STATE["logs"] = AUTO_BATCH_STATE["logs"][-200:]


def reset_batch_state(total: int, selected_relative_paths: list[str]):
    with AUTO_BATCH_LOCK:
        AUTO_BATCH_STATE["running"] = True
        AUTO_BATCH_STATE["total"] = int(total)
        AUTO_BATCH_STATE["processed"] = 0
        AUTO_BATCH_STATE["success_count"] = 0
        AUTO_BATCH_STATE["failed_count"] = 0
        AUTO_BATCH_STATE["current_image"] = ""
        AUTO_BATCH_STATE["selected_relative_paths"] = list(selected_relative_paths)
        AUTO_BATCH_STATE["logs"] = []


def finish_batch_state():
    with AUTO_BATCH_LOCK:
        AUTO_BATCH_STATE["running"] = False
        AUTO_BATCH_STATE["current_image"] = ""
        AUTO_BATCH_STATE["selected_relative_paths"] = []


def snapshot_batch_state():
    with AUTO_BATCH_LOCK:
        return {
            "running": AUTO_BATCH_STATE["running"],
            "total": AUTO_BATCH_STATE["total"],
            "processed": AUTO_BATCH_STATE["processed"],
            "success_count": AUTO_BATCH_STATE["success_count"],
            "failed_count": AUTO_BATCH_STATE["failed_count"],
            "current_image": AUTO_BATCH_STATE["current_image"],
            "selected_relative_paths": list(AUTO_BATCH_STATE["selected_relative_paths"]),
            "pending_count": len(AUTO_BATCH_PENDING),
            "logs": list(AUTO_BATCH_STATE["logs"]),
        }


def clear_pending_batch_result(relative_path: str):
    with AUTO_BATCH_LOCK:
        AUTO_BATCH_PENDING.pop(relative_path, None)


def set_pending_batch_result(relative_path: str, image_state: dict):
    with AUTO_BATCH_LOCK:
        AUTO_BATCH_PENDING[relative_path] = deepcopy(image_state)


def get_pending_batch_result(relative_path: str, consume: bool = False):
    with AUTO_BATCH_LOCK:
        if consume:
            pending = AUTO_BATCH_PENDING.pop(relative_path, None)
        else:
            pending = AUTO_BATCH_PENDING.get(relative_path)
        return deepcopy(pending) if pending is not None else None


def build_project_state_from_disk(config: dict):
    image_dir = config.get("image_dir", "")
    images = scan_images(image_dir)
    existing_state = load_project_state(config.get("output_dir", ""))
    image_states = build_image_states(
        images=images,
        image_id_start=config.get("image_id_start", 1),
        existing_state=existing_state,
    )
    project_state = {
        "version": 1,
        "categories": config.get("categories", []),
        "images": image_states
    }
    return images, project_state


def find_current_image(images, relative_path: str):
    for item in images:
        if item["relative_path"] == relative_path:
            return item
    return None


def get_selected_index(images, selected_relative_path: str):
    if not images:
        return -1

    selected_relative_path = str(selected_relative_path or "").strip()
    if not selected_relative_path:
        return 0

    for index, item in enumerate(images):
        if item.get("relative_path") == selected_relative_path:
            return index

    return 0


def build_image_state_response(
    config: dict,
    relative_path: str,
    include_pending: bool = True,
    consume_pending: bool = False
):
    images, project_state = build_project_state_from_disk(config)
    current_image = find_current_image(images, relative_path)
    if current_image is None:
        raise ValueError("未找到当前图像元数据")

    image_states = project_state.get("images", {})
    if relative_path not in image_states:
        raise ValueError("未找到当前图像状态")

    image_state = deepcopy(image_states[relative_path])
    has_pending_batch_result = False

    if include_pending:
        pending_image_state = get_pending_batch_result(
            relative_path,
            consume=consume_pending
        )
        if isinstance(pending_image_state, dict):
            image_state["temporary_annotations"] = pending_image_state.get("temporary_annotations", [])
            image_state = normalize_single_image_state(image_state)
            has_pending_batch_result = True

    return {
        "image_state": image_state,
        "has_pending_batch_result": has_pending_batch_result,
        "image_meta": current_image,
    }


def run_auto_annotate_for_relative_path(config: dict, relative_path: str, persist_mode: str = "project_state"):
    persist_mode = str(persist_mode or "project_state").strip().lower()
    if persist_mode not in {"project_state", "pending_batch"}:
        raise ValueError("persist_mode 非法")

    image_dir = config.get("image_dir", "")
    if not image_dir:
        return {
            "success": False,
            "message": "未配置图像目录",
            "logs": ["自动标注失败：未配置图像目录"]
        }

    image_root = Path(image_dir).resolve()
    image_path = (image_root / relative_path).resolve()

    try:
        image_path.relative_to(image_root)
    except ValueError:
        return {
            "success": False,
            "message": "非法图像路径",
            "logs": [f"自动标注失败：非法图像路径 {relative_path}"]
        }

    if not image_path.exists() or not image_path.is_file():
        return {
            "success": False,
            "message": "图像不存在",
            "logs": [f"自动标注失败：图像不存在 {relative_path}"]
        }

    images, project_state = build_project_state_from_disk(config)
    current_image = find_current_image(images, relative_path)
    if current_image is None:
        return {
            "success": False,
            "message": "未找到当前图像元数据",
            "logs": [f"自动标注失败：未找到图像元数据 {relative_path}"]
        }

    image_states = project_state["images"]
    if relative_path not in image_states:
        return {
            "success": False,
            "message": "未找到当前图像状态",
            "logs": [f"自动标注失败：未找到当前图像状态 {relative_path}"]
        }

    api_url = config.get("auto_annotate_api_url", "")
    token = config.get("auto_annotate_token", "")
    request_type = config.get("auto_annotate_request_type", "path")
    categories = config.get("categories", [])

    label_to_category = {}
    for category in categories:
        label_to_category[str(category["name"]).strip()] = {
            "category_id": int(category["id"]),
            "category_name": str(category["name"]).strip()
        }

    logs = []
    temporary_annotations = []

    try:
        api_result = call_inference_api(
            api_url=api_url,
            token=token,
            request_type=request_type,
            image_path=str(image_path)
        )
    except Exception as exc:
        logs.append(f"自动标注请求失败：{str(exc)}")
        return {
            "success": False,
            "message": f"自动标注请求失败：{str(exc)}",
            "logs": logs
        }

    if not isinstance(api_result, dict):
        logs.append("自动标注返回格式非法：顶层结果不是 JSON 对象")
        return {
            "success": False,
            "message": "自动标注返回格式非法",
            "logs": logs
        }

    results = api_result.get("results")
    if not isinstance(results, dict):
        logs.append("自动标注返回格式非法：缺少 results 字典")
        return {
            "success": False,
            "message": "自动标注返回格式非法",
            "logs": logs
        }

    if results.get("success") is not True:
        logs.append("推理失败：results.success 不为 true，本次自动标注已忽略")
        return {
            "success": False,
            "message": "推理失败",
            "logs": logs
        }

    pred_results = results.get("pred_results", [])
    if not isinstance(pred_results, list):
        logs.append("自动标注返回格式非法：pred_results 不是数组")
        return {
            "success": False,
            "message": "自动标注返回格式非法",
            "logs": logs
        }

    image_width = int(current_image.get("width", 0) or 0)
    image_height = int(current_image.get("height", 0) or 0)
    temporary_id = 1

    for pred in pred_results:
        if not isinstance(pred, dict):
            logs.append("已过滤自动标注结果：单条 pred_result 不是对象")
            continue

        label = str(pred.get("label", "")).strip()
        score = float(pred.get("score", 0))
        bbox = pred.get("bbox")

        if label not in label_to_category:
            logs.append(f"已过滤自动标注结果：label '{label}' 不在当前 categories 中")
            continue

        if not isinstance(bbox, list) or len(bbox) != 4:
            logs.append(f"已过滤自动标注结果：label '{label}' 的 bbox 格式非法")
            continue

        try:
            x1, y1, x2, y2 = [float(v) for v in bbox]
        except Exception:
            logs.append(f"已过滤自动标注结果：label '{label}' 的 bbox 数值非法")
            continue

        if x2 <= x1 or y2 <= y1:
            logs.append(f"已过滤自动标注结果：label '{label}' 的 bbox 非法，要求 x2>x1 且 y2>y1")
            continue

        if (
            x1 < 0 or y1 < 0 or
            x2 > image_width or y2 > image_height
        ):
            logs.append(
                f"已过滤自动标注结果：label '{label}' 的 bbox 越界 "
                f"[{x1}, {y1}, {x2}, {y2}]，图像尺寸为 {image_width}x{image_height}"
            )
            continue

        category_info = label_to_category[label]
        temporary_annotations.append({
            "temporary_id": temporary_id,
            "label": label,
            "category_name": category_info["category_name"],
            "category_id": category_info["category_id"],
            "score": score,
            "bbox": [x1, y1, x2, y2],
            "source": "auto"
        })
        temporary_id += 1

    image_state = image_states[relative_path]
    image_state["temporary_annotations"] = [
        normalize_temporary_annotation(item) for item in temporary_annotations
    ]
    image_state = normalize_single_image_state(image_state)

    if persist_mode == "project_state":
        clear_pending_batch_result(relative_path)
        image_states[relative_path] = image_state
        project_state["images"] = image_states
        save_project_state(config.get("output_dir", ""), project_state)
        logs.append(f"自动标注完成：采纳 {len(temporary_annotations)} 个临时框，并已写入项目状态")
    else:
        set_pending_batch_result(relative_path, image_state)
        logs.append(f"自动标注完成：采纳 {len(temporary_annotations)} 个临时框，已写入批量临时缓存")

    return {
        "success": True,
        "message": "自动标注完成",
        "image_state": image_state,
        "temporary_annotations": image_state.get("temporary_annotations", []),
        "logs": logs
    }


def batch_auto_annotate_worker(selected_relative_paths: list[str]):
    config = load_config()

    try:
        for relative_path in selected_relative_paths:
            with AUTO_BATCH_LOCK:
                AUTO_BATCH_STATE["current_image"] = relative_path

            append_batch_log(f"开始自动标注：{relative_path}")
            result = run_auto_annotate_for_relative_path(config, relative_path, persist_mode="pending_batch")

            with AUTO_BATCH_LOCK:
                AUTO_BATCH_STATE["processed"] += 1
                if result.get("success"):
                    AUTO_BATCH_STATE["success_count"] += 1
                else:
                    AUTO_BATCH_STATE["failed_count"] += 1

            for log_item in result.get("logs", []):
                append_batch_log(f"{relative_path} | {log_item}")

        append_batch_log("批量自动标注全部完成")
    except Exception as exc:
        append_batch_log(f"批量自动标注异常中止：{str(exc)}")
    finally:
        finish_batch_state()


@app.route("/")
def settings_page():
    return render_template("settings.html")


@app.route("/gallery")
def gallery_page():
    config = load_config()
    return render_template("gallery.html", config=config)


@app.route("/annotate")
def annotate_page():
    config = load_config()
    selected_relative_path = str(request.args.get("relative_path", "")).strip()
    return render_template(
        "annotate.html",
        config=config,
        selected_relative_path=selected_relative_path
    )

@app.route("/overview")
def overview_page():
    config = load_config()
    return render_template("overview.html", config=config)

@app.route("/api/config", methods=["GET"])
def get_config():
    config = load_config()
    return jsonify({
        "success": True,
        "config": config
    })


@app.route("/api/config", methods=["POST"])
def update_config():
    payload = request.get_json(silent=True) or {}

    try:
        normalized_config = validate_and_normalize_config(payload)
        save_config(normalized_config)
        return jsonify({
            "success": True,
            "message": "配置已保存",
            "config": normalized_config,
            "redirect_url": url_for("overview_page")
        })
    except Exception as exc:
        return jsonify({
            "success": False,
            "message": f"配置保存失败: {str(exc)}"
        }), 400


@app.route("/api/images", methods=["GET"])
def get_images():
    config = load_config()
    image_dir = config.get("image_dir", "")
    images = scan_images(image_dir)

    return jsonify({
        "success": True,
        "images": images,
        "count": len(images)
    })


@app.route("/api/annotate/init", methods=["GET"])
def annotate_init():
    config = load_config()
    images, project_state = build_project_state_from_disk(config)
    image_states = project_state["images"]

    start_image = str(request.args.get("start_image", "")).strip()

    current_index = 0 if images else -1
    if start_image and images:
        matched_index = -1
        for index, item in enumerate(images):
            if str(item.get("relative_path", "")).strip() == start_image:
                matched_index = index
                break
        if matched_index >= 0:
            current_index = matched_index

    next_anno_id = compute_next_anno_id(
        image_states=image_states,
        annotation_id_start=config.get("annotation_id_start", 1)
    )

    return jsonify({
        "success": True,
        "config": config,
        "images": images,
        "image_states": image_states,
        "project_state": project_state,
        "count": len(images),
        "current_index": current_index,
        "next_anno_id": next_anno_id,
        "batch_state": snapshot_batch_state()
    })


@app.route("/api/image-state", methods=["GET"])
def get_image_state():
    config = load_config()
    relative_path = str(request.args.get("relative_path", "")).strip()
    consume_pending = str(request.args.get("consume_pending", "0")).strip() == "1"

    if not relative_path:
        return jsonify({
            "success": False,
            "message": "缺少 relative_path"
        }), 400

    try:
        result = build_image_state_response(
            config,
            relative_path,
            include_pending=True,
            consume_pending=consume_pending
        )
        return jsonify({
            "success": True,
            "image_state": result["image_state"],
            "has_pending_batch_result": result["has_pending_batch_result"],
            "image_meta": result["image_meta"]
        })
    except Exception as exc:
        return jsonify({
            "success": False,
            "message": f"获取图片状态失败: {str(exc)}"
        }), 404


@app.route("/api/project/save", methods=["POST"])
def save_project():
    config = load_config()
    payload = request.get_json(silent=True) or {}

    image_states = payload.get("image_states", {})
    categories = config.get("categories", [])

    if not isinstance(image_states, dict):
        image_states = {}

    with AUTO_BATCH_LOCK:
        pending_snapshot = {
            key: deepcopy(value)
            for key, value in AUTO_BATCH_PENDING.items()
        }
    merged_pending_count = len(pending_snapshot)
    print(f"[save_project] merge pending image count = {merged_pending_count}")
    for relative_path, pending_image_state in pending_snapshot.items():
        if not isinstance(pending_image_state, dict):
            continue

        if relative_path not in image_states or not isinstance(image_states[relative_path], dict):
            image_states[relative_path] = pending_image_state
            continue

        image_states[relative_path]["temporary_annotations"] = deepcopy(
            pending_image_state.get("temporary_annotations", [])
        )

    try:
        project_state = normalize_project_state({
            "version": 1,
            "categories": categories,
            "images": image_states
        })
        save_project_state(config.get("output_dir", ""), project_state)


        next_anno_id = compute_next_anno_id(
            image_states=project_state.get("images", {}),
            annotation_id_start=config.get("annotation_id_start", 1)
        )

        return jsonify({
            "success": True,
            "message": "项目状态已保存",
            "next_anno_id": next_anno_id
        })
    except Exception as exc:
        return jsonify({
            "success": False,
            "message": f"保存失败: {str(exc)}"
        }), 400


@app.route("/api/export/coco", methods=["GET"])
def export_coco():
    config = load_config()
    output_dir = config.get("output_dir", "")
    project_state = load_project_state(output_dir)
    categories = config.get("categories", [])

    try:
        coco_data = build_coco_export(project_state=project_state, categories=categories)
        export_path = save_coco_export_file(output_dir=output_dir, coco_data=coco_data)

        return send_file(
            export_path,
            as_attachment=True,
            download_name="coco_export.json",
            mimetype="application/json"
        )
    except Exception as exc:
        return jsonify({
            "success": False,
            "message": f"导出失败: {str(exc)}"
        }), 400


@app.route("/api/auto-annotate/current", methods=["POST"])
def auto_annotate_current():
    config = load_config()
    payload = request.get_json(silent=True) or {}
    relative_path = str(payload.get("relative_path", "")).strip()

    if not relative_path:
        return jsonify({
            "success": False,
            "message": "缺少 relative_path",
            "logs": ["自动标注失败：缺少 relative_path"]
        }), 400

    result = run_auto_annotate_for_relative_path(config, relative_path, persist_mode="project_state")
    status_code = 200 if result.get("success") else 400
    if result.get("message") == "推理失败":
        status_code = 200
    return jsonify(result), status_code


@app.route("/api/auto-annotate/batch/start", methods=["POST"])
def auto_annotate_batch_start():
    config = load_config()
    payload = request.get_json(silent=True) or {}
    selected_relative_paths = payload.get("selected_relative_paths", [])

    if not str(config.get("auto_annotate_api_url", "")).strip():
        return jsonify({
            "success": False,
            "message": "未配置自动标注 API URL"
        }), 400

    if not isinstance(selected_relative_paths, list):
        return jsonify({
            "success": False,
            "message": "selected_relative_paths 必须为数组"
        }), 400

    selected_relative_paths = [str(item).strip() for item in selected_relative_paths if str(item).strip()]
    if not selected_relative_paths:
        return jsonify({
            "success": False,
            "message": "请至少选择一张图片"
        }), 400

    images, _ = build_project_state_from_disk(config)
    image_map = {item["relative_path"]: item for item in images}
    filtered_relative_paths = [item for item in selected_relative_paths if item in image_map]

    if not filtered_relative_paths:
        return jsonify({
            "success": False,
            "message": "选中的图片均不存在"
        }), 400

    with AUTO_BATCH_LOCK:
        if AUTO_BATCH_STATE["running"]:
            return jsonify({
                "success": False,
                "message": "批量自动标注任务已在运行中",
                "batch_state": snapshot_batch_state()
            }), 400

    reset_batch_state(len(filtered_relative_paths), filtered_relative_paths)
    append_batch_log(f"批量自动标注已启动，共 {len(filtered_relative_paths)} 张图片")

    worker = Thread(target=batch_auto_annotate_worker, args=(filtered_relative_paths,), daemon=True)
    worker.start()

    return jsonify({
        "success": True,
        "message": f"批量自动标注已启动，共 {len(filtered_relative_paths)} 张图片",
        "batch_state": snapshot_batch_state()
    })


@app.route("/api/auto-annotate/batch/status", methods=["GET"])
def auto_annotate_batch_status():
    return jsonify({
        "success": True,
        "batch_state": snapshot_batch_state()
    })


@app.route("/api/temporary-annotations/action", methods=["POST"])
def temporary_annotations_action():
    config = load_config()
    payload = request.get_json(silent=True) or {}

    relative_path = str(payload.get("relative_path", "")).strip()
    action = str(payload.get("action", "")).strip()
    selected_ids = payload.get("selected_temporary_ids", [])

    if not relative_path:
        return jsonify({
            "success": False,
            "message": "缺少 relative_path",
            "logs": ["临时框操作失败：缺少 relative_path"]
        }), 400

    if action not in {"delete_selected", "clear_all", "convert_selected"}:
        return jsonify({
            "success": False,
            "message": "不支持的 action",
            "logs": [f"临时框操作失败：不支持的 action {action}"]
        }), 400

    if not isinstance(selected_ids, list):
        selected_ids = []

    try:
        selected_ids = [int(v) for v in selected_ids]
    except Exception:
        return jsonify({
            "success": False,
            "message": "selected_temporary_ids 非法",
            "logs": ["临时框操作失败：selected_temporary_ids 非法"]
        }), 400

    images, project_state = build_project_state_from_disk(config)
    image_states = project_state["images"]

    if relative_path not in image_states:
        return jsonify({
            "success": False,
            "message": "未找到图像状态",
            "logs": [f"临时框操作失败：未找到图像状态 {relative_path}"]
        }), 404

    image_state = deepcopy(image_states[relative_path])
    pending_image_state = get_pending_batch_result(relative_path)
    if isinstance(pending_image_state, dict):
        image_state["temporary_annotations"] = pending_image_state.get("temporary_annotations", [])

    image_state = normalize_single_image_state(image_state)
    temporary_annotations = image_state.get("temporary_annotations", [])
    annotations = image_state.get("annotations", [])
    logs = []

    if action == "clear_all":
        cleared_count = len(temporary_annotations)
        image_state["temporary_annotations"] = []
        logs.append(f"已清空当前图像全部临时框，共 {cleared_count} 个")

    elif action == "delete_selected":
        selected_set = set(selected_ids)
        before_count = len(temporary_annotations)
        remained = [item for item in temporary_annotations if int(item["temporary_id"]) not in selected_set]
        deleted_count = before_count - len(remained)
        image_state["temporary_annotations"] = remained
        logs.append(f"已删除选中临时框，共 {deleted_count} 个")

    elif action == "convert_selected":
        selected_set = set(selected_ids)
        if not selected_set:
            return jsonify({
                "success": False,
                "message": "未选择任何临时框",
                "logs": ["保留选中框失败：未选择任何临时框"]
            }), 400

        next_anno_id = compute_next_anno_id(
            image_states=image_states,
            annotation_id_start=config.get("annotation_id_start", 1)
        )

        kept_count = 0
        remained_temporary = []

        for temp_ann in temporary_annotations:
            temp_id = int(temp_ann["temporary_id"])
            if temp_id in selected_set:
                annotations.append({
                    "anno_id": next_anno_id,
                    "category_id": int(temp_ann["category_id"]),
                    "category_name": str(temp_ann["category_name"]),
                    "bbox": temp_ann["bbox"],
                    "source": "manual"
                })
                logs.append(
                    f"转换成功：temporary_id={temp_id} -> anno_id={next_anno_id} "
                    f"({temp_ann['category_name']})"
                )
                next_anno_id += 1
                kept_count += 1
            else:
                remained_temporary.append(temp_ann)

        annotations.sort(key=lambda item: int(item["anno_id"]))
        image_state["annotations"] = annotations
        image_state["temporary_annotations"] = remained_temporary
        logs.append(f"保留选中框完成，共转换 {kept_count} 个临时框为正式标注")

    image_states[relative_path] = normalize_single_image_state(image_state)
    project_state["images"] = image_states
    save_project_state(config.get("output_dir", ""), project_state)
    clear_pending_batch_result(relative_path)

    next_anno_id = compute_next_anno_id(
        image_states=image_states,
        annotation_id_start=config.get("annotation_id_start", 1)
    )
    logs.append(
        f"写盘后状态：annotations={len(image_states[relative_path].get('annotations', []))}, "
        f"temporary={len(image_states[relative_path].get('temporary_annotations', []))}"
    )
    return jsonify({
        "success": True,
        "message": "临时框操作完成",
        "image_state": image_states[relative_path],
        "next_anno_id": next_anno_id,
        "logs": logs
    })


@app.route("/image/<path:relative_path>")
def serve_image(relative_path: str):
    config = load_config()
    image_dir = config.get("image_dir", "")
    if not image_dir:
        return jsonify({"success": False, "message": "未配置图像目录"}), 400

    image_root = Path(image_dir).resolve()
    safe_target = (image_root / relative_path).resolve()

    try:
        safe_target.relative_to(image_root)
    except ValueError:
        return jsonify({"success": False, "message": "非法路径"}), 403

    if not safe_target.exists() or not safe_target.is_file():
        return jsonify({"success": False, "message": "图像不存在"}), 404

    return send_from_directory(str(image_root), relative_path)


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "success": True,
        "message": "ok"
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5100)