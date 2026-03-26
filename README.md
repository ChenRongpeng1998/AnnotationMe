# AnnotationMe

一个基于 Flask 的图像标注工具，支持手动标注和自动标注功能。

## 功能特性

- 🖼️ **图像浏览** - 支持 JPG、PNG、BMP、GIF、WebP 格式
- ✏️ **手动标注** - 框选标注工具，支持自定义类别
- 🤖 **自动标注** - 调用推理 API 自动标注，支持批量处理
- 📦 **COCO 导出** - 一键导出 COCO 格式标注文件
- 💾 **项目管理** - 自动保存标注状态，支持断点续标

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置项目

首次运行时，会在项目目录生成 `user_config.json` 配置文件：

```json
{
  "image_dir": "D:/images/dataset",
  "output_dir": "./output",
  "categories": [
    {"id": 1, "name": "button"},
    {"id": 2, "name": "knob"}
  ],
  "image_id_start": 1,
  "annotation_id_start": 1,
  "auto_annotate_api_url": "",
  "auto_annotate_token": "",
  "auto_annotate_request_type": "path"
}
```

### 3. 启动服务

```bash
python app.py
```

访问 http://localhost:5100 开始标注。

## 项目结构

```
AnnotationMe/
├── app.py              # Flask 主应用
├── config.py           # 配置管理
├── data_manager.py     # 数据管理（扫描图像、保存状态、COCO 导出）
├── api_client.py       # 自动标注 API 客户端
├── user_config.json    # 用户配置文件
├── templates/          # HTML 模板
│   ├── annotate.html   # 标注页面
│   ├── overview.html   # 概览页面
│   └── settings.html   # 设置页面
├── static/             # 静态资源
│   ├── css/
│   ├── js/
│   └── bootstrap/
└── output/             # 输出目录
    ├── annotation_state.json
    └── coco_export.json
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 设置页面 |
| `/annotate` | GET | 标注页面 |
| `/overview` | GET | 概览页面 |
| `/api/config` | GET/POST | 获取/更新配置 |
| `/api/images` | GET | 获取图像列表 |
| `/api/annotate/init` | GET | 初始化标注会话 |
| `/api/image-state` | GET | 获取单张图像状态 |
| `/api/project/save` | POST | 保存项目状态 |
| `/api/export/coco` | GET | 导出 COCO 格式 |
| `/api/auto-annotate/current` | POST | 单张自动标注 |
| `/api/auto-annotate/batch/start` | POST | 启动批量自动标注 |
| `/api/auto-annotate/batch/status` | GET | 获取批量任务状态 |

## 自动标注配置

如需使用自动标注功能，需配置推理 API：

- `auto_annotate_api_url`: 推理 API 地址
- `auto_annotate_token`: API 认证令牌
- `auto_annotate_request_type`: 请求类型（`path` 或 `image`）
  - `path`: 发送图像路径
  - `image`: 上传图像文件

## 技术栈

- **后端**: Python 3.11+, Flask
- **前端**: Bootstrap 5, JavaScript
- **数据格式**: JSON, COCO

## 许可证

MIT License
