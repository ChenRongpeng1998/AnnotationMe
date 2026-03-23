(function () {
    const state = {
        config: window.__ANNOTATE_PAGE_CONFIG__ || {},
        images: [],
        imageStates: {},
        currentIndex: -1,
        nextAnnoId: 1,

        selectedTemporaryIdsMap: {},
        selectedBatchRelativePaths: new Set(),

        mode: "select",
        selectedAnnoId: null,

        creating: null,
        view: {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            isPanning: false,
            panStartClientX: 0,
            panStartClientY: 0,
            panOriginOffsetX: 0,
            panOriginOffsetY: 0
        },

        interaction: {
            active: false,
            type: null,
            annoId: null,
            handle: null,
            startClientX: 0,
            startClientY: 0,
            startBbox: null,
            didDrag: false
        },

        batch: {
            running: false,
            timerId: null,
            lastProcessed: -1,
            seenCompletedPaths: new Set()
        },

        suppressNextStageClick: false,

        imageMeta: {
            naturalWidth: 0,
            naturalHeight: 0,
            loaded: false
        }
    };

    const leftToolbarButtons = document.getElementById("left-toolbar-buttons");
    const prevImageBtn = document.getElementById("prev-image-btn");
    const nextImageBtn = document.getElementById("next-image-btn");
    const imageIndexText = document.getElementById("image-index-text");
    const imageNameText = document.getElementById("image-name-text");
    const zoomText = document.getElementById("zoom-text");

    const statusCurrentTool = document.getElementById("status-current-tool");
    const statusCurrentImage = document.getElementById("status-current-image");
    const statusCurrentZoom = document.getElementById("status-current-zoom");
    const statusCurrentSelected = document.getElementById("status-current-selected");
    const statusCurrentHint = document.getElementById("status-current-hint");
    const selectedSummaryBadge = document.getElementById("selected-summary-badge");

    const batchAutoStatusText = document.getElementById("batch-auto-status-text");
    const batchAutoProgressText = document.getElementById("batch-auto-progress-text");
    const batchAutoCurrentText = document.getElementById("batch-auto-current-text");
    const batchAutoPanelStatus = document.getElementById("batch-auto-panel-status");
    const batchImageList = document.getElementById("batch-image-list");
    const batchSelectAllBtn = document.getElementById("batch-select-all-btn");
    const batchUnselectAllBtn = document.getElementById("batch-unselect-all-btn");
    const batchStartBtn = document.getElementById("batch-start-btn");

    const imageStage = document.getElementById("image-stage");
    const canvasViewport = document.getElementById("canvas-viewport");
    const canvasContent = document.getElementById("canvas-content");
    const mainImage = document.getElementById("main-image");
    const annotationLayer = document.getElementById("annotation-layer");
    const temporaryLayer = document.getElementById("temporary-layer");
    const previewLayer = document.getElementById("preview-layer");
    const imageEmptyPlaceholder = document.getElementById("image-empty-placeholder");
    const stageHintText = document.getElementById("stage-hint-text");

    const categoriesList = document.getElementById("categories-list");
    const logList = document.getElementById("log-scroll-container");
    const annotationList = document.getElementById("annotation-list");
    const temporaryAnnotationList = document.getElementById("temporary-annotation-list");
    const autoApiSummary = document.getElementById("auto-api-summary");

    const createCategorySelect = document.getElementById("create-category-select");
    const editCategorySelect = document.getElementById("edit-category-select");
    const selectedEmptyTip = document.getElementById("selected-empty-tip");
    const selectedAnnotationEditor = document.getElementById("selected-annotation-editor");
    const editAnnoIdInput = document.getElementById("edit-anno-id");
    const editBboxX1Input = document.getElementById("edit-bbox-x1");
    const editBboxY1Input = document.getElementById("edit-bbox-y1");
    const editBboxX2Input = document.getElementById("edit-bbox-x2");
    const editBboxY2Input = document.getElementById("edit-bbox-y2");
    const deleteSelectedBtn = document.getElementById("delete-selected-btn");
    const modeBadge = document.getElementById("mode-badge");

    const saveProjectBtn = document.getElementById("save-project-btn");
    const exportCocoBtn = document.getElementById("export-coco-btn");
    const runAutoAnnotateBtn = document.getElementById("run-auto-annotate-btn");
    const autoTabRunBtn = document.getElementById("auto-tab-run-btn");

    const clearTemporaryBtn = document.getElementById("clear-temporary-btn");
    const convertSelectedTemporaryBtn = document.getElementById("convert-selected-temporary-btn");

    const openShortcutHelpBtn = document.getElementById("open-shortcut-help-btn");
    const closeShortcutHelpBtn = document.getElementById("close-shortcut-help-btn");
    const shortcutHelpPanel = document.getElementById("shortcut-help-panel");
    const toastContainer = document.getElementById("toast-container");

    const rectModeBtn = document.getElementById("rect-mode-btn");
    const panModeBtn = document.getElementById("pan-mode-btn");
    const fitImageBtn = document.getElementById("fit-image-btn");
    const zoomInBtn = document.getElementById("zoom-in-btn");
    const zoomOutBtn = document.getElementById("zoom-out-btn");

    const bottomRectBtn = document.getElementById("bottom-rect-btn");
    const bottomPanBtn = document.getElementById("bottom-pan-btn");
    const bottomDeleteBtn = document.getElementById("bottom-delete-btn");
    const bottomSaveBtn = document.getElementById("bottom-save-btn");
    const bottomExportCocoBtn = document.getElementById("bottom-export-coco-btn");
    const bottomAutoAnnotateBtn = document.getElementById("bottom-auto-annotate-btn");
    const bottomZoomInBtn = document.getElementById("bottom-zoom-in-btn");
    const bottomZoomOutBtn = document.getElementById("bottom-zoom-out-btn");
    const bottomFitBtn = document.getElementById("bottom-fit-btn");

    const TOOL_LABEL_MAP = {
        select: "选择",
        bbox: "BBox",
        delete: "删除",
        zoom_in: "放大",
        zoom_out: "缩小",
        fit: "适配",
        prev: "上一张",
        next: "下一张"
    };

    const RESIZE_HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
    const MIN_BOX_SIZE = 1;

    function showToast(message, type = "info") {
        const toast = document.createElement("div");
        toast.className = `toast-item toast-${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        window.setTimeout(() => {
            toast.remove();
        }, 2600);
    }

    function addLog(message) {
        const item = document.createElement("div");
        item.className = "sidebar-item log-entry";
        item.textContent = `[${new Date().toLocaleString()}] ${message}`;
        logList.appendChild(item);
        logList.scrollTop = logList.scrollHeight;
    }

    function safeFetchJson(url, options = {}, fallbackMessage = "请求失败") {
        return fetch(url, options)
            .then(async (response) => {
                let data = null;
                try {
                    data = await response.json();
                } catch (error) {
                    throw new Error(`${fallbackMessage}：服务端未返回合法 JSON`);
                }

                if (!response.ok) {
                    throw new Error(data?.message || fallbackMessage);
                }

                return data;
            });
    }

    function getCurrentImage() {
        if (state.currentIndex < 0 || state.currentIndex >= state.images.length) {
            return null;
        }
        return state.images[state.currentIndex];
    }

    function getCurrentRelativePath() {
        const current = getCurrentImage();
        return current ? current.relative_path : "";
    }

    function createDefaultSelectedSetForCurrentTemporary() {
        const tempList = getCurrentTemporaryAnnotations();
        return new Set(tempList.map(item => Number(item.temporary_id)));
    }

    function syncSelectedTemporaryIdsWithCurrentState(forceSelectAllIfMissing = false) {
        const relativePath = getCurrentRelativePath();
        if (!relativePath) {
            return new Set();
        }

        const currentIds = new Set(getCurrentTemporaryAnnotations().map(item => Number(item.temporary_id)));
        let selectedSet = state.selectedTemporaryIdsMap[relativePath];

        if (!selectedSet || forceSelectAllIfMissing) {
            selectedSet = new Set(currentIds);
            state.selectedTemporaryIdsMap[relativePath] = selectedSet;
            return selectedSet;
        }

        const newSet = new Set();
        currentIds.forEach((id) => {
            if (selectedSet.has(id)) {
                newSet.add(id);
            }
        });

        state.selectedTemporaryIdsMap[relativePath] = newSet;
        return newSet;
    }

    function getSelectedTemporaryIdSet() {
        const relativePath = getCurrentRelativePath();
        if (!relativePath) {
            return new Set();
        }
        if (!state.selectedTemporaryIdsMap[relativePath]) {
            state.selectedTemporaryIdsMap[relativePath] = createDefaultSelectedSetForCurrentTemporary();
        }
        return state.selectedTemporaryIdsMap[relativePath];
    }

    function selectAllCurrentTemporaryIds() {
        const relativePath = getCurrentRelativePath();
        if (!relativePath) {
            return;
        }
        state.selectedTemporaryIdsMap[relativePath] = createDefaultSelectedSetForCurrentTemporary();
    }

    function ensureCurrentImageState() {
        const current = getCurrentImage();
        if (!current) {
            return null;
        }

        const relativePath = current.relative_path;
        if (!state.imageStates[relativePath]) {
            state.imageStates[relativePath] = {
                image_id: Number(state.config.image_id_start || 1) + state.currentIndex,
                file_name: current.name,
                width: Number(current.width || 0),
                height: Number(current.height || 0),
                annotations: [],
                temporary_annotations: []
            };
        }

        const imageState = state.imageStates[relativePath];
        imageState.image_id = Number(state.config.image_id_start || 1) + state.currentIndex;
        imageState.file_name = current.name;
        imageState.width = Number(current.width || imageState.width || 0);
        imageState.height = Number(current.height || imageState.height || 0);

        if (!Array.isArray(imageState.annotations)) {
            imageState.annotations = [];
        }
        if (!Array.isArray(imageState.temporary_annotations)) {
            imageState.temporary_annotations = [];
        }

        return imageState;
    }

    function getCurrentImageState() {
        return ensureCurrentImageState();
    }

    function getCurrentTemporaryAnnotations() {
        const imageState = getCurrentImageState();
        if (!imageState) {
            return [];
        }
        if (!Array.isArray(imageState.temporary_annotations)) {
            imageState.temporary_annotations = [];
        }
        return imageState.temporary_annotations;
    }

    function getVisibleTemporaryAnnotations() {
        const selectedSet = getSelectedTemporaryIdSet();
        return getCurrentTemporaryAnnotations().filter(item => selectedSet.has(Number(item.temporary_id)));
    }

    function getCategories() {
        return Array.isArray(state.config.categories) ? state.config.categories : [];
    }

    function getCategoryById(categoryId) {
        return getCategories().find(item => Number(item.id) === Number(categoryId)) || null;
    }

    function getSelectedAnnotation() {
        const imageState = getCurrentImageState();
        if (!imageState || !state.selectedAnnoId) {
            return null;
        }
        return imageState.annotations.find(item => item.anno_id === state.selectedAnnoId) || null;
    }

    function getAnnotationById(annoId) {
        const imageState = getCurrentImageState();
        if (!imageState) {
            return null;
        }
        return imageState.annotations.find(item => item.anno_id === annoId) || null;
    }

    function clampToImage(x, y) {
        return {
            x: Math.max(0, Math.min(state.imageMeta.naturalWidth, x)),
            y: Math.max(0, Math.min(state.imageMeta.naturalHeight, y))
        };
    }

    function sanitizeBbox(x1, y1, x2, y2) {
        const p1 = clampToImage(Number(x1), Number(y1));
        const p2 = clampToImage(Number(x2), Number(y2));

        const left = Math.min(p1.x, p2.x);
        const top = Math.min(p1.y, p2.y);
        const right = Math.max(p1.x, p2.x);
        const bottom = Math.max(p1.y, p2.y);

        if (right <= left || bottom <= top) {
            return null;
        }

        return [left, top, right, bottom];
    }

    async function fetchAndMergeImageState(relativePath, forceSelectAllTemp = false) {
        if (!relativePath) {
            return;
        }
        try {
            const result = await safeFetchJson(`/api/image-state?relative_path=${encodeURIComponent(relativePath)}`, {}, "获取图片状态失败");
            if (!result.success) {
                return;
            }
            state.imageStates[relativePath] = result.image_state;
            if (getCurrentRelativePath() === relativePath) {
                syncSelectedTemporaryIdsWithCurrentState(forceSelectAllTemp);
                renderAllAnnotationUi();
            }
        } catch (error) {
            addLog(`同步图片状态失败：${error.message}`);
        }
    }

    function updateStageHint(text) {
        stageHintText.textContent = text;
        statusCurrentHint.textContent = `提示：${text}`;
    }

    function updateToolbarLinkedState() {
        const setActive = (el, active) => {
            if (!el) return;
            el.classList.toggle("tool-active", active);
        };

        const rectActive = state.mode === "rect";
        const panActive = state.mode === "pan";

        setActive(rectModeBtn, rectActive);
        setActive(bottomRectBtn, rectActive);
        setActive(panModeBtn, panActive);
        setActive(bottomPanBtn, panActive);
    }

    function updateTopStatus() {
        const modeLabel = state.mode === "rect" ? "矩形框" : (state.mode === "pan" ? "手型拖动" : "选择");
        statusCurrentTool.textContent = `当前工具：${modeLabel}`;

        const total = state.images.length;
        const currentImageText = (state.currentIndex >= 0 && total > 0)
            ? `${state.currentIndex + 1} / ${total}`
            : "0 / 0";
        statusCurrentImage.textContent = `当前图片：${currentImageText}`;

        const zoomPercent = Math.round(state.view.scale * 100);
        statusCurrentZoom.textContent = `当前缩放：${zoomPercent}%`;

        const selected = getSelectedAnnotation();
        if (selected) {
            statusCurrentSelected.textContent = `当前选中：#${selected.anno_id} | ${selected.category_name}`;
            selectedSummaryBadge.textContent = `选中：#${selected.anno_id} | ${selected.category_name}`;
            selectedSummaryBadge.className = "badge text-bg-success";
        } else {
            statusCurrentSelected.textContent = "当前选中：无";
            selectedSummaryBadge.textContent = "未选中标注框";
            selectedSummaryBadge.className = "badge text-bg-secondary";
        }
    }

    function updateBatchStatusUi(batchState) {
        const running = !!batchState?.running;
        const total = Number(batchState?.total || 0);
        const processed = Number(batchState?.processed || 0);
        const successCount = Number(batchState?.success_count || 0);
        const failedCount = Number(batchState?.failed_count || 0);
        const currentImage = batchState?.current_image || "无";

        batchAutoStatusText.textContent = running ? "批量标注：运行中" : "批量标注：空闲";
        batchAutoProgressText.textContent = `进度：${processed} / ${total}`;
        batchAutoCurrentText.textContent = `当前：${currentImage}`;

        batchAutoPanelStatus.innerHTML = `
            <div>状态：${running ? "运行中" : "空闲"}</div>
            <div>总数：${total}</div>
            <div>已处理：${processed}</div>
            <div>成功：${successCount}</div>
            <div>失败：${failedCount}</div>
            <div>当前图片：${currentImage}</div>
        `;
    }

    function renderBatchImageList() {
        batchImageList.innerHTML = "";

        if (!state.images.length) {
            const empty = document.createElement("div");
            empty.className = "sidebar-item";
            empty.textContent = "当前没有图片可供批量标注";
            batchImageList.appendChild(empty);
            return;
        }

        state.images.forEach((imageItem, index) => {
            const relativePath = imageItem.relative_path;
            const checked = state.selectedBatchRelativePaths.has(relativePath);

            const item = document.createElement("div");
            item.className = "sidebar-item";

            const checkboxId = `batch-image-checkbox-${index}`;

            item.innerHTML = `
                <div class="d-flex align-items-start gap-2">
                    <div class="form-check mt-1">
                        <input class="form-check-input batch-image-checkbox" type="checkbox" id="${checkboxId}" ${checked ? "checked" : ""}>
                    </div>
                    <div class="flex-grow-1">
                        <div class="annotation-list-title">${relativePath}</div>
                        <div class="annotation-list-meta">
                            file_name: ${imageItem.name}<br>
                            size: ${imageItem.width || 0} x ${imageItem.height || 0}
                        </div>
                    </div>
                </div>
            `;

            const checkbox = item.querySelector(".batch-image-checkbox");
            checkbox.addEventListener("change", function () {
                if (checkbox.checked) {
                    state.selectedBatchRelativePaths.add(relativePath);
                } else {
                    state.selectedBatchRelativePaths.delete(relativePath);
                }
            });

            batchImageList.appendChild(item);
        });
    }

    function initBatchSelectionDefault() {
        state.selectedBatchRelativePaths = new Set(state.images.map(item => item.relative_path));
        renderBatchImageList();
    }

    function isCurrentImageBeingEdited() {
        return !!(state.creating || state.interaction.active || state.view.isPanning);
    }

    function getNewlyCompletedPaths(batchState) {
        const completedPaths = Array.isArray(batchState?.completed_relative_paths)
            ? batchState.completed_relative_paths
            : [];

        const newPaths = [];
        completedPaths.forEach((relativePath) => {
            if (!state.batch.seenCompletedPaths.has(relativePath)) {
                state.batch.seenCompletedPaths.add(relativePath);
                newPaths.push(relativePath);
            }
        });
        return newPaths;
    }

    async function pollBatchStatus() {
        try {
            const result = await safeFetchJson("/api/auto-annotate/batch/status", {}, "获取批量状态失败");
            if (!result.success) {
                return;
            }

            const batchState = result.batch_state || {};
            updateBatchStatusUi(batchState);

            const processed = Number(batchState.processed || 0);
            const newlyCompletedPaths = getNewlyCompletedPaths(batchState);
            if (processed !== state.batch.lastProcessed) {
                state.batch.lastProcessed = processed;
            }

            const currentRelativePath = getCurrentRelativePath();
            const currentImageJustCompleted = !!currentRelativePath && newlyCompletedPaths.includes(currentRelativePath);
            if (currentImageJustCompleted && !isCurrentImageBeingEdited()) {
                await fetchAndMergeImageState(currentRelativePath, false);
            }

            if (batchState.running) {
                state.batch.running = true;
                if (!state.batch.timerId) {
                    state.batch.timerId = window.setInterval(pollBatchStatus, 1500);
                }
            } else {
                state.batch.running = false;
                if (state.batch.timerId) {
                    window.clearInterval(state.batch.timerId);
                    state.batch.timerId = null;
                }
            }
        } catch (error) {
            addLog(`批量状态轮询失败：${error.message}`);
        }
    }

    async function startBatchAutoAnnotate() {
        const selectedRelativePaths = Array.from(state.selectedBatchRelativePaths);
        if (!selectedRelativePaths.length) {
            showToast("请先勾选至少一张图片", "error");
            return;
        }

        try {
            const result = await safeFetchJson("/api/auto-annotate/batch/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    selected_relative_paths: selectedRelativePaths
                })
            }, "启动批量标注失败");

            if (!result.success) {
                showToast(result.message || "启动失败", "error");
                return;
            }

            updateBatchStatusUi(result.batch_state || {});
            showToast(result.message || "批量标注已启动", "success");
            addLog(result.message || "批量标注已启动");

            state.batch.running = true;
            state.batch.lastProcessed = -1;
            state.batch.seenCompletedPaths = new Set();

            if (state.batch.timerId) {
                window.clearInterval(state.batch.timerId);
            }
            state.batch.timerId = window.setInterval(pollBatchStatus, 1500);
            pollBatchStatus();
        } catch (error) {
            addLog(`启动批量标注失败：${error.message}`);
            showToast(error.message, "error");
        }
    }

    function setMode(mode) {
        state.mode = mode;
        updateModeUi();
        updateToolbarLinkedState();
        updateTopStatus();

        if (mode !== "rect") {
            cancelCurrentCreating(false);
        }

        if (mode === "rect") {
            updateStageHint("矩形框模式：第一次点击记录起点，第二次点击完成成框");
            addLog("已进入矩形框标注模式");
        } else if (mode === "pan") {
            updateStageHint("手型拖动模式：按下鼠标左键拖动画布");
            addLog("已进入手型拖动模式");
        } else {
            updateStageHint("选择模式：点击绿色正式框可选中，拖动框体可移动，拖动控制点可改变大小");
            addLog("已进入选择模式");
        }
    }

    function updateModeUi() {
        imageStage.classList.remove("cursor-rect", "cursor-pan", "cursor-select", "dragging");

        if (state.mode === "rect") {
            imageStage.classList.add("cursor-rect");
            modeBadge.textContent = "模式：矩形框";
            modeBadge.className = "badge text-bg-success";
            rectModeBtn.className = "btn btn-success btn-sm";
            panModeBtn.className = "btn btn-outline-secondary btn-sm";
        } else if (state.mode === "pan") {
            imageStage.classList.add("cursor-pan");
            modeBadge.textContent = "模式：手型拖动";
            modeBadge.className = "badge text-bg-secondary";
            rectModeBtn.className = "btn btn-outline-secondary btn-sm";
            panModeBtn.className = "btn btn-secondary btn-sm";
        } else {
            imageStage.classList.add("cursor-select");
            modeBadge.textContent = "模式：选择";
            modeBadge.className = "badge text-bg-primary";
            rectModeBtn.className = "btn btn-outline-secondary btn-sm";
            panModeBtn.className = "btn btn-outline-secondary btn-sm";
        }
    }

    function renderToolbar() {
        const tools = Array.isArray(state.config.toolbar_tools) ? state.config.toolbar_tools : [];
        leftToolbarButtons.innerHTML = "";

        if (tools.length === 0) {
            const empty = document.createElement("div");
            empty.className = "sidebar-item";
            empty.textContent = "当前未配置常用工具";
            leftToolbarButtons.appendChild(empty);
            return;
        }

        tools.forEach((tool) => {
            const btn = document.createElement("button");
            btn.className = "btn btn-outline-secondary btn-sm";
            btn.textContent = TOOL_LABEL_MAP[tool] || tool;
            btn.dataset.tool = tool;

            if (tool === "prev") {
                btn.addEventListener("click", showPrevImage);
            } else if (tool === "next") {
                btn.addEventListener("click", showNextImage);
            } else if (tool === "bbox") {
                btn.addEventListener("click", () => setMode("rect"));
            } else if (tool === "delete") {
                btn.addEventListener("click", deleteSelectedAnnotation);
            } else if (tool === "zoom_in") {
                btn.addEventListener("click", () => zoomAtViewportCenter(1.2));
            } else if (tool === "zoom_out") {
                btn.addEventListener("click", () => zoomAtViewportCenter(1 / 1.2));
            } else if (tool === "fit") {
                btn.addEventListener("click", fitImageToViewport);
            } else if (tool === "select") {
                btn.addEventListener("click", () => setMode("select"));
            } else {
                btn.addEventListener("click", function () {
                    addLog(`点击工具: ${tool}（当前未绑定具体行为）`);
                });
            }

            leftToolbarButtons.appendChild(btn);
        });
    }

    function fillCategorySelect(selectEl) {
        selectEl.innerHTML = "";
        const categories = getCategories();

        categories.forEach((category) => {
            const option = document.createElement("option");
            option.value = String(category.id);
            option.textContent = `${category.name} (id=${category.id})`;
            option.dataset.categoryName = category.name;
            selectEl.appendChild(option);
        });
    }

    function renderCategories() {
        categoriesList.innerHTML = "";
        fillCategorySelect(createCategorySelect);
        fillCategorySelect(editCategorySelect);

        const categories = getCategories();
        if (categories.length === 0) {
            const empty = document.createElement("div");
            empty.className = "sidebar-item";
            empty.textContent = "未配置 categories";
            categoriesList.appendChild(empty);
            return;
        }

        categories.forEach((category) => {
            const item = document.createElement("div");
            item.className = "sidebar-item";
            item.innerHTML = `
                <div><strong>category_id:</strong> ${category.id}</div>
                <div><strong>category_name:</strong> ${category.name}</div>
            `;
            categoriesList.appendChild(item);
        });
    }

    function renderAutoApiSummary() {
        const apiUrl = state.config.auto_annotate_api_url || "";
        const requestType = state.config.auto_annotate_request_type || "path";
        const tokenText = state.config.auto_annotate_token ? "已配置" : "未配置";

        autoApiSummary.innerHTML = `
            <div><strong>API URL:</strong> ${apiUrl || "未配置"}</div>
            <div><strong>请求类型:</strong> ${requestType}</div>
            <div><strong>Token:</strong> ${tokenText}</div>
        `;
    }

    function updateImageStatus() {
        const total = state.images.length;
        if (total === 0 || state.currentIndex < 0 || state.currentIndex >= total) {
            imageIndexText.textContent = "0 / 0";
            imageNameText.textContent = "当前无图像";
            prevImageBtn.disabled = true;
            nextImageBtn.disabled = true;
            updateTopStatus();
            return;
        }

        const current = state.images[state.currentIndex];
        imageIndexText.textContent = `${state.currentIndex + 1} / ${total}`;
        imageNameText.textContent = current.relative_path || current.name || "未命名图像";

        prevImageBtn.disabled = state.currentIndex <= 0;
        nextImageBtn.disabled = state.currentIndex >= total - 1;
        updateTopStatus();
    }

    function updateZoomText() {
        const zoomPercent = Math.round(state.view.scale * 100);
        zoomText.textContent = `缩放：${zoomPercent}%`;
        updateTopStatus();
    }

    function applyTransform() {
        canvasContent.style.transform = `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.scale})`;
        updateZoomText();
    }

    function resetViewState() {
        state.view.scale = 1;
        state.view.offsetX = 0;
        state.view.offsetY = 0;
        state.view.isPanning = false;
        state.view.panStartClientX = 0;
        state.view.panStartClientY = 0;
        state.view.panOriginOffsetX = 0;
        state.view.panOriginOffsetY = 0;
        imageStage.classList.remove("dragging");
        applyTransform();
    }

    function fitImageToViewport() {
        if (!state.imageMeta.loaded) {
            return;
        }

        const viewportWidth = canvasViewport.clientWidth;
        const viewportHeight = canvasViewport.clientHeight;
        const imageWidth = state.imageMeta.naturalWidth;
        const imageHeight = state.imageMeta.naturalHeight;

        if (!viewportWidth || !viewportHeight || !imageWidth || !imageHeight) {
            return;
        }

        const fitScale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);

        state.view.scale = fitScale;
        state.view.offsetX = (viewportWidth - imageWidth * fitScale) / 2;
        state.view.offsetY = (viewportHeight - imageHeight * fitScale) / 2;
        state.view.isPanning = false;

        applyTransform();
        addLog("图像已适配到视口");
    }

    function zoomAtPoint(clientX, clientY, scaleFactor) {
        if (!state.imageMeta.loaded) {
            return;
        }

        const rect = canvasViewport.getBoundingClientRect();
        const oldScale = state.view.scale;
        const newScale = Math.max(0.1, Math.min(20, oldScale * scaleFactor));

        const viewportX = clientX - rect.left;
        const viewportY = clientY - rect.top;

        const imageX = (viewportX - state.view.offsetX) / oldScale;
        const imageY = (viewportY - state.view.offsetY) / oldScale;

        state.view.scale = newScale;
        state.view.offsetX = viewportX - imageX * newScale;
        state.view.offsetY = viewportY - imageY * newScale;

        applyTransform();
    }

    function zoomAtViewportCenter(scaleFactor) {
        const rect = canvasViewport.getBoundingClientRect();
        zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scaleFactor);
    }

    function getPointOnImage(clientX, clientY) {
        if (!state.imageMeta.loaded) {
            return { valid: false, x: 0, y: 0 };
        }

        const rect = canvasViewport.getBoundingClientRect();
        const viewportX = clientX - rect.left;
        const viewportY = clientY - rect.top;

        const x = (viewportX - state.view.offsetX) / state.view.scale;
        const y = (viewportY - state.view.offsetY) / state.view.scale;

        const valid = (
            x >= 0 &&
            y >= 0 &&
            x <= state.imageMeta.naturalWidth &&
            y <= state.imageMeta.naturalHeight
        );

        return { valid, x, y };
    }

    function normalizeBbox(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const right = Math.max(x1, x2);
        const bottom = Math.max(y1, y2);
        return [left, top, right, bottom];
    }

    function getSelectedCategoryForCreate() {
        const selectedOption = createCategorySelect.options[createCategorySelect.selectedIndex];
        if (!selectedOption) {
            return null;
        }

        return {
            category_id: Number(selectedOption.value),
            category_name: selectedOption.dataset.categoryName || selectedOption.textContent
        };
    }

    function beginAnnotationInteraction(event, annoId, type, handle = null) {
        const annotation = getAnnotationById(annoId);
        if (!annotation) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (state.mode !== "select") {
            setMode("select");
        }

        state.selectedAnnoId = annoId;
        state.interaction.active = true;
        state.interaction.type = type;
        state.interaction.annoId = annoId;
        state.interaction.handle = handle;
        state.interaction.startClientX = event.clientX;
        state.interaction.startClientY = event.clientY;
        state.interaction.startBbox = [...annotation.bbox];
        state.interaction.didDrag = false;

        renderAllAnnotationUi();

        if (type === "move") {
            updateStageHint(`正在移动正式框 #${annoId}`);
        } else {
            updateStageHint(`正在调整正式框 #${annoId} 大小`);
        }
    }

    function applyMoveToBbox(startBbox, dxImage, dyImage) {
        const [x1, y1, x2, y2] = startBbox;
        const width = x2 - x1;
        const height = y2 - y1;

        let newX1 = x1 + dxImage;
        let newY1 = y1 + dyImage;

        newX1 = Math.max(0, Math.min(state.imageMeta.naturalWidth - width, newX1));
        newY1 = Math.max(0, Math.min(state.imageMeta.naturalHeight - height, newY1));

        return [newX1, newY1, newX1 + width, newY1 + height];
    }

    function applyResizeToBbox(startBbox, dxImage, dyImage, handle) {
        let [x1, y1, x2, y2] = startBbox;

        if (handle.includes("w")) x1 += dxImage;
        if (handle.includes("e")) x2 += dxImage;
        if (handle.includes("n")) y1 += dyImage;
        if (handle.includes("s")) y2 += dyImage;

        x1 = Math.max(0, Math.min(state.imageMeta.naturalWidth, x1));
        x2 = Math.max(0, Math.min(state.imageMeta.naturalWidth, x2));
        y1 = Math.max(0, Math.min(state.imageMeta.naturalHeight, y1));
        y2 = Math.max(0, Math.min(state.imageMeta.naturalHeight, y2));

        if (handle.includes("w") && x1 > x2 - MIN_BOX_SIZE) x1 = x2 - MIN_BOX_SIZE;
        if (handle.includes("e") && x2 < x1 + MIN_BOX_SIZE) x2 = x1 + MIN_BOX_SIZE;
        if (handle.includes("n") && y1 > y2 - MIN_BOX_SIZE) y1 = y2 - MIN_BOX_SIZE;
        if (handle.includes("s") && y2 < y1 + MIN_BOX_SIZE) y2 = y1 + MIN_BOX_SIZE;

        x1 = Math.max(0, x1);
        y1 = Math.max(0, y1);
        x2 = Math.min(state.imageMeta.naturalWidth, x2);
        y2 = Math.min(state.imageMeta.naturalHeight, y2);

        return [x1, y1, x2, y2];
    }

    function updateInteractingAnnotation(clientX, clientY) {
        if (!state.interaction.active) return;

        const annotation = getAnnotationById(state.interaction.annoId);
        if (!annotation) return;

        const dxImage = (clientX - state.interaction.startClientX) / state.view.scale;
        const dyImage = (clientY - state.interaction.startClientY) / state.view.scale;

        let newBbox = state.interaction.startBbox;
        if (state.interaction.type === "move") {
            newBbox = applyMoveToBbox(state.interaction.startBbox, dxImage, dyImage);
        } else if (state.interaction.type === "resize") {
            newBbox = applyResizeToBbox(state.interaction.startBbox, dxImage, dyImage, state.interaction.handle);
        }

        annotation.bbox = newBbox;
        state.interaction.didDrag = true;
        renderAllAnnotationUi();
    }

    function endAnnotationInteraction() {
        if (!state.interaction.active) return;

        const didDrag = state.interaction.didDrag;
        const annoId = state.interaction.annoId;

        state.interaction.active = false;
        state.interaction.type = null;
        state.interaction.annoId = null;
        state.interaction.handle = null;
        state.interaction.startClientX = 0;
        state.interaction.startClientY = 0;
        state.interaction.startBbox = null;

        if (didDrag) {
            state.suppressNextStageClick = true;
            addLog(`已更新正式框 #${annoId} 的位置或大小`);
            showToast(`已更新正式框 #${annoId}`, "success");
        }

        if (state.mode === "select") {
            updateStageHint("选择模式：点击绿色正式框可选中，拖动框体可移动，拖动控制点可改变大小");
        }
    }

    function renderAnnotations() {
        const imageState = getCurrentImageState();
        annotationLayer.innerHTML = "";

        if (!imageState || !Array.isArray(imageState.annotations)) return;

        imageState.annotations.forEach((annotation) => {
            const [x1, y1, x2, y2] = annotation.bbox;
            const box = document.createElement("div");
            box.className = "annotation-box";
            if (annotation.anno_id === state.selectedAnnoId) box.classList.add("selected");
            if (state.interaction.active && state.interaction.annoId === annotation.anno_id) box.classList.add("dragging-box");

            box.style.left = `${x1}px`;
            box.style.top = `${y1}px`;
            box.style.width = `${x2 - x1}px`;
            box.style.height = `${y2 - y1}px`;
            box.style.borderWidth = `${Number(state.config.bbox_line_width || 2)}px`;
            box.dataset.annoId = String(annotation.anno_id);
            box.title = `anno_id: ${annotation.anno_id}\ncategory: ${annotation.category_name}\nbbox: [${annotation.bbox.map(v => Math.round(v)).join(", ")}]`;

            const label = document.createElement("div");
            label.className = "annotation-label";
            label.textContent = `${annotation.category_name} | #${annotation.anno_id}`;
            box.appendChild(label);

            box.addEventListener("click", function (event) {
                event.stopPropagation();
                if (!state.interaction.didDrag) selectAnnotation(annotation.anno_id);
            });

            box.addEventListener("mousedown", function (event) {
                if (event.button !== 0) return;
                beginAnnotationInteraction(event, annotation.anno_id, "move", null);
            });

            if (annotation.anno_id === state.selectedAnnoId) {
                RESIZE_HANDLES.forEach((handle) => {
                    const handleEl = document.createElement("div");
                    handleEl.className = "annotation-resize-handle";
                    handleEl.dataset.handle = handle;
                    handleEl.addEventListener("mousedown", function (event) {
                        if (event.button !== 0) return;
                        beginAnnotationInteraction(event, annotation.anno_id, "resize", handle);
                    });
                    box.appendChild(handleEl);
                });
            }

            annotationLayer.appendChild(box);
        });
    }

    function renderTemporaryAnnotations() {
        const visibleTemporaryAnnotations = getVisibleTemporaryAnnotations();
        temporaryLayer.innerHTML = "";

        visibleTemporaryAnnotations.forEach((annotation) => {
            const [x1, y1, x2, y2] = annotation.bbox;
            const box = document.createElement("div");
            box.className = "temporary-box selected-visible";
            box.style.left = `${x1}px`;
            box.style.top = `${y1}px`;
            box.style.width = `${x2 - x1}px`;
            box.style.height = `${y2 - y1}px`;
            box.style.borderWidth = `${Number(state.config.bbox_line_width || 2)}px`;
            box.title = `temporary_id: ${annotation.temporary_id}\nlabel: ${annotation.label || annotation.category_name}\nscore: ${Number(annotation.score).toFixed(4)}\nbbox: [${annotation.bbox.map(v => Math.round(v)).join(", ")}]`;

            const label = document.createElement("div");
            label.className = "temporary-label";
            const displayLabel = annotation.label || annotation.category_name;
            label.textContent = `${displayLabel} | t#${annotation.temporary_id} | ${Number(annotation.score).toFixed(3)}`;
            box.appendChild(label);

            temporaryLayer.appendChild(box);
        });
    }

    function renderPreview() {
        previewLayer.innerHTML = "";

        if (!state.creating) return;

        const point = document.createElement("div");
        point.className = "preview-point";
        point.style.left = `${state.creating.startX}px`;
        point.style.top = `${state.creating.startY}px`;
        previewLayer.appendChild(point);

        if (typeof state.creating.currentX === "number" && typeof state.creating.currentY === "number") {
            const [x1, y1, x2, y2] = normalizeBbox(
                state.creating.startX,
                state.creating.startY,
                state.creating.currentX,
                state.creating.currentY
            );

            const box = document.createElement("div");
            box.className = "preview-box";
            box.style.left = `${x1}px`;
            box.style.top = `${y1}px`;
            box.style.width = `${x2 - x1}px`;
            box.style.height = `${y2 - y1}px`;
            box.style.borderWidth = `${Number(state.config.bbox_line_width || 2)}px`;
            previewLayer.appendChild(box);
        }
    }

    function renderAnnotationList() {
        const imageState = getCurrentImageState();
        annotationList.innerHTML = "";

        if (!imageState || imageState.annotations.length === 0) {
            const empty = document.createElement("div");
            empty.className = "sidebar-item";
            empty.textContent = "当前图像暂无正式标注";
            annotationList.appendChild(empty);
            return;
        }

        imageState.annotations.forEach((annotation) => {
            const item = document.createElement("div");
            item.className = "sidebar-item annotation-list-item";
            if (annotation.anno_id === state.selectedAnnoId) item.classList.add("active");

            item.innerHTML = `
                <div class="annotation-list-title">#${annotation.anno_id} | ${annotation.category_name}</div>
                <div class="annotation-list-meta">
                    category_id: ${annotation.category_id}<br>
                    bbox: [${annotation.bbox.map(v => Math.round(v)).join(", ")}]
                </div>
            `;

            item.addEventListener("click", function () {
                selectAnnotation(annotation.anno_id);
            });

            annotationList.appendChild(item);
        });
    }

    function renderTemporaryAnnotationList() {
        const temporaryAnnotations = getCurrentTemporaryAnnotations();
        const selectedSet = getSelectedTemporaryIdSet();
        temporaryAnnotationList.innerHTML = "";

        if (temporaryAnnotations.length === 0) {
            const empty = document.createElement("div");
            empty.className = "sidebar-item";
            empty.textContent = "当前图像暂无临时自动标注";
            temporaryAnnotationList.appendChild(empty);
            return;
        }

        temporaryAnnotations.forEach((annotation) => {
            const tempId = Number(annotation.temporary_id);
            const checked = selectedSet.has(tempId);

            const item = document.createElement("div");
            item.className = "sidebar-item";
            if (checked) item.classList.add("temporary-item-checked");

            const checkboxId = `temp-checkbox-${tempId}`;

            item.innerHTML = `
                <div class="d-flex align-items-start gap-2">
                    <div class="form-check mt-1">
                        <input class="form-check-input temporary-checkbox" type="checkbox" id="${checkboxId}" ${checked ? "checked" : ""}>
                    </div>
                    <div class="flex-grow-1">
                        <div class="annotation-list-title">t#${tempId} | ${annotation.label || annotation.category_name}</div>
                        <div class="annotation-list-meta">
                            label: ${annotation.label || annotation.category_name}<br>
                            score: ${Number(annotation.score).toFixed(4)}<br>
                            bbox: [${annotation.bbox.map(v => Math.round(v)).join(", ")}]
                        </div>
                    </div>
                </div>
            `;

            const checkbox = item.querySelector(".temporary-checkbox");
            checkbox.addEventListener("change", function () {
                if (checkbox.checked) {
                    selectedSet.add(tempId);
                } else {
                    selectedSet.delete(tempId);
                }
                renderAllAnnotationUi();
            });

            temporaryAnnotationList.appendChild(item);
        });
    }

    function renderSelectedEditor() {
        const annotation = getSelectedAnnotation();

        if (!annotation) {
            selectedEmptyTip.classList.remove("d-none");
            selectedAnnotationEditor.classList.add("d-none");
            editAnnoIdInput.value = "";
            editBboxX1Input.value = "";
            editBboxY1Input.value = "";
            editBboxX2Input.value = "";
            editBboxY2Input.value = "";
            updateTopStatus();
            return;
        }

        selectedEmptyTip.classList.add("d-none");
        selectedAnnotationEditor.classList.remove("d-none");

        editAnnoIdInput.value = annotation.anno_id;
        editCategorySelect.value = String(annotation.category_id);
        editBboxX1Input.value = Math.round(annotation.bbox[0]);
        editBboxY1Input.value = Math.round(annotation.bbox[1]);
        editBboxX2Input.value = Math.round(annotation.bbox[2]);
        editBboxY2Input.value = Math.round(annotation.bbox[3]);
        updateTopStatus();
    }

    function renderAllAnnotationUi() {
        syncSelectedTemporaryIdsWithCurrentState(false);
        renderAnnotations();
        renderTemporaryAnnotations();
        renderPreview();
        renderAnnotationList();
        renderTemporaryAnnotationList();
        renderSelectedEditor();
        updateTopStatus();
    }

    function selectAnnotation(annoId) {
        state.selectedAnnoId = annoId;
        renderAllAnnotationUi();
        addLog(`已选中标注框 #${annoId}`);
    }

    function clearSelection() {
        state.selectedAnnoId = null;
        renderAllAnnotationUi();
    }

    function cancelCurrentCreating(writeLog = true) {
        state.creating = null;
        renderPreview();

        if (state.mode === "rect") {
            updateStageHint("矩形框模式：第一次点击记录起点，第二次点击完成成框");
        }

        if (writeLog) addLog("已取消当前创建中的矩形框");
    }

    function createAnnotationBySecondClick(endX, endY) {
        const imageState = getCurrentImageState();
        if (!imageState || !state.creating) return;

        const [x1, y1, x2, y2] = normalizeBbox(
            state.creating.startX,
            state.creating.startY,
            endX,
            endY
        );

        if (x2 - x1 < 1 || y2 - y1 < 1) {
            addLog("非法框已取消：第二次点击无效，宽高必须大于 0");
            showToast("非法框已取消", "error");
            state.creating.currentX = endX;
            state.creating.currentY = endY;
            renderPreview();
            return;
        }

        const category = getSelectedCategoryForCreate();
        if (!category) {
            addLog("创建失败：未选择 category");
            showToast("创建失败：未选择 category", "error");
            return;
        }

        const annotation = {
            anno_id: state.nextAnnoId++,
            category_id: category.category_id,
            category_name: category.category_name,
            bbox: [x1, y1, x2, y2],
            source: "manual"
        };

        imageState.annotations.push(annotation);
        imageState.annotations.sort((a, b) => a.anno_id - b.anno_id);

        state.selectedAnnoId = annotation.anno_id;
        state.creating = null;

        renderAllAnnotationUi();
        updateStageHint("成框完成，可继续两次点击创建下一个框");
        addLog(`标注创建成功：#${annotation.anno_id} (${annotation.category_name})`);
        showToast(`标注创建成功 #${annotation.anno_id}`, "success");
    }

    function deleteSelectedAnnotation() {
        const imageState = getCurrentImageState();
        if (!imageState || !state.selectedAnnoId) {
            addLog("当前没有选中的框可删除");
            showToast("当前没有选中的框可删除", "error");
            return;
        }

        const deletingId = state.selectedAnnoId;
        const confirmed = window.confirm(`确认删除正式标注框 #${deletingId} 吗？`);
        if (!confirmed) {
            addLog(`已取消删除正式标注框 #${deletingId}`);
            return;
        }

        const before = imageState.annotations.length;
        imageState.annotations = imageState.annotations.filter(item => item.anno_id !== deletingId);
        const after = imageState.annotations.length;

        if (after < before) {
            state.selectedAnnoId = null;
            renderAllAnnotationUi();
            addLog(`删除成功：标注框 #${deletingId}`);
            showToast(`已删除正式框 #${deletingId}`, "success");
        }
    }

    function updateSelectedAnnotationCategory() {
        const annotation = getSelectedAnnotation();
        if (!annotation) return;

        const category = getCategoryById(Number(editCategorySelect.value));
        if (!category) return;

        annotation.category_id = Number(category.id);
        annotation.category_name = category.name;
        renderAllAnnotationUi();
        addLog(`已更新标注框 #${annotation.anno_id} 的 category 为 ${category.name}`);
    }

    function updateSelectedAnnotationBbox() {
        const annotation = getSelectedAnnotation();
        if (!annotation) return;

        const x1 = Number(editBboxX1Input.value);
        const y1 = Number(editBboxY1Input.value);
        const x2 = Number(editBboxX2Input.value);
        const y2 = Number(editBboxY2Input.value);

        if ([x1, y1, x2, y2].some(v => Number.isNaN(v))) return;

        const bbox = sanitizeBbox(x1, y1, x2, y2);
        if (!bbox) return;

        annotation.bbox = bbox;
        renderAllAnnotationUi();
    }

    async function saveProjectState() {
        try {
            const result = await safeFetchJson("/api/project/save", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    image_states: state.imageStates
                })
            }, "保存失败");

            if (typeof result.next_anno_id === "number") {
                state.nextAnnoId = result.next_anno_id;
            }

            addLog(result.message || "保存成功");
            showToast(result.message || "保存成功", "success");
            return true;
        } catch (error) {
            addLog(`保存失败: ${error.message}`);
            showToast(error.message, "error");
            return false;
        }
    }

    async function exportCocoJson() {
        const saved = await saveProjectState();
        if (!saved) {
            addLog("导出已取消：项目状态保存失败");
            return;
        }

        addLog("开始导出 COCO JSON");
        showToast("开始导出 COCO JSON", "info");
        window.location.href = "/api/export/coco";
        window.setTimeout(() => {
            showToast("导出请求已发出", "success");
        }, 300);
    }

    async function runAutoAnnotate() {
        const current = getCurrentImage();
        if (!current) {
            addLog("自动标注失败：当前没有图像");
            showToast("推理失败", "error");
            alert("推理失败");
            return;
        }

        if (!state.config.auto_annotate_api_url) {
            addLog("自动标注失败：未配置自动标注 API URL");
            showToast("未配置自动标注 API URL", "error");
            alert("推理失败");
            return;
        }

        try {
            showToast("正在调用自动标注 API...", "info");
            const result = await safeFetchJson("/api/auto-annotate/current", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    relative_path: current.relative_path
                })
            }, "自动标注失败");

            if (Array.isArray(result.logs)) {
                result.logs.forEach(addLog);
            }

            if (!result.success) {
                showToast("推理失败", "error");
                alert("推理失败");
                return;
            }

            state.imageStates[current.relative_path] = result.image_state;
            selectAllCurrentTemporaryIds();
            renderAllAnnotationUi();
            showToast("自动标注完成，已默认全选全部临时框", "success");
        } catch (error) {
            addLog(`自动标注失败：${error.message}`);
            showToast(error.message, "error");
            alert("推理失败");
        }
    }

    async function applyTemporaryAction(action) {
        const current = getCurrentImage();
        if (!current) {
            addLog("临时框操作失败：当前没有图像");
            showToast("当前没有图像", "error");
            return;
        }

        const selectedIds = Array.from(getSelectedTemporaryIdSet());

        if (action === "convert_selected" && selectedIds.length === 0) {
            addLog("保留选中框失败：当前没有勾选任何临时框");
            showToast("当前没有勾选任何临时框", "error");
            return;
        }

        if (action === "clear_all") {
            const confirmed = window.confirm("确认清空当前图像全部临时标注吗？");
            if (!confirmed) {
                addLog("已取消清空临时标注");
                return;
            }
        }

        if (action === "convert_selected") {
            const confirmed = window.confirm(`确认将当前勾选的 ${selectedIds.length} 个临时框转为绿色正式标注吗？`);
            if (!confirmed) {
                addLog("已取消保留选中框");
                return;
            }
        }

        try {
            const result = await safeFetchJson("/api/temporary-annotations/action", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    relative_path: current.relative_path,
                    action: action,
                    selected_temporary_ids: selectedIds
                })
            }, "临时框操作失败");

            if (Array.isArray(result.logs)) {
                result.logs.forEach(addLog);
            }

            if (!result.success) {
                return;
            }

            state.imageStates[current.relative_path] = result.image_state;

            if (typeof result.next_anno_id === "number") {
                state.nextAnnoId = result.next_anno_id;
            }

            if (action === "convert_selected") {
                selectAllCurrentTemporaryIds();
            } else if (action === "clear_all") {
                state.selectedTemporaryIdsMap[current.relative_path] = new Set();
            }

            renderAllAnnotationUi();

            if (action === "convert_selected") {
                showToast("保留选中框成功，已转为正式标注", "success");
            } else if (action === "clear_all") {
                showToast("已清空临时标注", "success");
            }
        } catch (error) {
            addLog(`临时框操作失败：${error.message}`);
            showToast(error.message, "error");
        }
    }

    function resetImageSessionState() {
        state.selectedAnnoId = null;
        state.creating = null;
        state.imageMeta.loaded = false;
        previewLayer.innerHTML = "";
        annotationLayer.innerHTML = "";
        temporaryLayer.innerHTML = "";
        resetViewState();
        endAnnotationInteraction();
    }

    async function updateImageDisplay() {
        const total = state.images.length;

        if (total === 0 || state.currentIndex < 0 || state.currentIndex >= total) {
            updateImageStatus();
            mainImage.style.display = "none";
            mainImage.removeAttribute("src");
            imageEmptyPlaceholder.style.display = "flex";
            canvasContent.style.display = "none";
            annotationLayer.innerHTML = "";
            temporaryLayer.innerHTML = "";
            previewLayer.innerHTML = "";
            resetViewState();
            renderAllAnnotationUi();
            updateStageHint("当前没有可显示图像");
            return;
        }

        const current = state.images[state.currentIndex];
        updateImageStatus();
        resetImageSessionState();

        await fetchAndMergeImageState(current.relative_path, true);

        imageEmptyPlaceholder.style.display = "none";
        canvasContent.style.display = "block";
        mainImage.src = current.url;
        mainImage.style.display = "block";

        renderAllAnnotationUi();
        updateStageHint("图像加载中...");
    }

    async function showImageByIndex(index) {
        if (index < 0 || index >= state.images.length) return;
        state.currentIndex = index;
        await updateImageDisplay();
        const current = state.images[state.currentIndex];
        addLog(`切换图像: ${current.relative_path}`);
    }

    function showPrevImage() {
        if (state.currentIndex > 0) {
            showImageByIndex(state.currentIndex - 1);
        }
    }

    function showNextImage() {
        if (state.currentIndex < state.images.length - 1) {
            showImageByIndex(state.currentIndex + 1);
        }
    }

    function initTabs() {
        const tabButtons = document.querySelectorAll(".tab-button");
        const tabContents = document.querySelectorAll(".tab-content");

        tabButtons.forEach((button) => {
            button.addEventListener("click", function () {
                const targetId = button.dataset.tab;

                tabButtons.forEach((btn) => btn.classList.remove("active"));
                tabContents.forEach((content) => content.classList.remove("active"));

                button.classList.add("active");
                const target = document.getElementById(targetId);
                if (target) target.classList.add("active");
            });
        });
    }

    function handleStageClick(event) {
        if (state.suppressNextStageClick) {
            state.suppressNextStageClick = false;
            return;
        }

        if (!state.imageMeta.loaded) return;

        if (state.mode !== "rect") {
            clearSelection();
            updateStageHint("已取消选中，可点击绿色框重新选中");
            return;
        }

        const point = getPointOnImage(event.clientX, event.clientY);
        if (!point.valid) {
            addLog("点击位置不在图像区域内");
            showToast("点击位置不在图像区域内", "error");
            return;
        }

        if (!state.creating) {
            state.creating = {
                startX: point.x,
                startY: point.y,
                currentX: point.x,
                currentY: point.y
            };
            clearSelection();
            renderPreview();
            updateStageHint(`已记录起点 (${Math.round(point.x)}, ${Math.round(point.y)})，请点击第二个点完成成框`);
            addLog(`第一次点击已记录起点: (${Math.round(point.x)}, ${Math.round(point.y)})`);
        } else {
            createAnnotationBySecondClick(point.x, point.y);
        }
    }

    function handleStageMouseMove(event) {
        if (!state.imageMeta.loaded) return;

        if (state.interaction.active) {
            updateInteractingAnnotation(event.clientX, event.clientY);
            return;
        }

        if (state.view.isPanning) {
            const dx = event.clientX - state.view.panStartClientX;
            const dy = event.clientY - state.view.panStartClientY;
            state.view.offsetX = state.view.panOriginOffsetX + dx;
            state.view.offsetY = state.view.panOriginOffsetY + dy;
            applyTransform();
            return;
        }

        if (state.mode === "rect" && state.creating) {
            const point = getPointOnImage(event.clientX, event.clientY);
            if (point.valid) {
                state.creating.currentX = point.x;
                state.creating.currentY = point.y;
                renderPreview();
            }
        }
    }

    function handleStageMouseDown(event) {
        if (state.mode !== "pan" || !state.imageMeta.loaded) return;

        state.view.isPanning = true;
        state.view.panStartClientX = event.clientX;
        state.view.panStartClientY = event.clientY;
        state.view.panOriginOffsetX = state.view.offsetX;
        state.view.panOriginOffsetY = state.view.offsetY;
        imageStage.classList.add("dragging");
        updateStageHint("拖动中...");
    }

    function handleGlobalMouseUp() {
        if (state.interaction.active) {
            endAnnotationInteraction();
        }

        if (state.view.isPanning) {
            state.view.isPanning = false;
            imageStage.classList.remove("dragging");
            updateStageHint("手型拖动模式：按下鼠标左键拖动画布");
        }
    }

    function handleWheel(event) {
        if (!state.imageMeta.loaded) return;

        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : (1 / 1.1);
        zoomAtPoint(event.clientX, event.clientY, factor);
    }

    function bindTopAndBottomButtons() {
        rectModeBtn.addEventListener("click", () => setMode("rect"));
        panModeBtn.addEventListener("click", () => setMode("pan"));
        fitImageBtn.addEventListener("click", fitImageToViewport);
        zoomInBtn.addEventListener("click", () => zoomAtViewportCenter(1.2));
        zoomOutBtn.addEventListener("click", () => zoomAtViewportCenter(1 / 1.2));
        saveProjectBtn.addEventListener("click", saveProjectState);
        exportCocoBtn.addEventListener("click", exportCocoJson);
        runAutoAnnotateBtn.addEventListener("click", runAutoAnnotate);
        autoTabRunBtn.addEventListener("click", runAutoAnnotate);

        batchSelectAllBtn.addEventListener("click", function () {
            state.selectedBatchRelativePaths = new Set(state.images.map(item => item.relative_path));
            renderBatchImageList();
        });

        batchUnselectAllBtn.addEventListener("click", function () {
            state.selectedBatchRelativePaths = new Set();
            renderBatchImageList();
        });

        batchStartBtn.addEventListener("click", startBatchAutoAnnotate);

        clearTemporaryBtn.addEventListener("click", () => applyTemporaryAction("clear_all"));
        convertSelectedTemporaryBtn.addEventListener("click", () => applyTemporaryAction("convert_selected"));

        bottomRectBtn.addEventListener("click", () => setMode("rect"));
        bottomPanBtn.addEventListener("click", () => setMode("pan"));
        bottomDeleteBtn.addEventListener("click", deleteSelectedAnnotation);
        bottomSaveBtn.addEventListener("click", saveProjectState);
        bottomExportCocoBtn.addEventListener("click", exportCocoJson);
        bottomAutoAnnotateBtn.addEventListener("click", runAutoAnnotate);
        bottomZoomInBtn.addEventListener("click", () => zoomAtViewportCenter(1.2));
        bottomZoomOutBtn.addEventListener("click", () => zoomAtViewportCenter(1 / 1.2));
        bottomFitBtn.addEventListener("click", fitImageToViewport);

        deleteSelectedBtn.addEventListener("click", deleteSelectedAnnotation);
    }

    function bindStageEvents() {
        imageStage.addEventListener("click", handleStageClick);
        imageStage.addEventListener("mousemove", handleStageMouseMove);
        imageStage.addEventListener("mousedown", handleStageMouseDown);
        imageStage.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("mouseup", handleGlobalMouseUp);
    }

    function bindKeyboardShortcuts() {
        document.addEventListener("keydown", function (event) {
            if (event.ctrlKey && event.key.toLowerCase() === "s") {
                event.preventDefault();
                saveProjectState();
                return;
            }

            if (event.key === "Delete") {
                event.preventDefault();
                deleteSelectedAnnotation();
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                if (state.interaction.active) {
                    endAnnotationInteraction();
                    return;
                }
                cancelCurrentCreating(true);
                return;
            }

            if (event.key === "?") {
                shortcutHelpPanel.classList.toggle("d-none");
                return;
            }

            const tagName = (event.target.tagName || "").toLowerCase();
            const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select";
            if (isTyping) return;

            if (event.key.toLowerCase() === "r") {
                event.preventDefault();
                setMode("rect");
            } else if (event.key.toLowerCase() === "h") {
                event.preventDefault();
                setMode("pan");
            }
        });
    }

    function bindEditorEvents() {
        editCategorySelect.addEventListener("change", updateSelectedAnnotationCategory);

        [editBboxX1Input, editBboxY1Input, editBboxX2Input, editBboxY2Input].forEach((input) => {
            input.addEventListener("input", updateSelectedAnnotationBbox);
            input.addEventListener("change", updateSelectedAnnotationBbox);
        });
    }

    function bindHelpPanelEvents() {
        openShortcutHelpBtn.addEventListener("click", function () {
            shortcutHelpPanel.classList.remove("d-none");
        });

        closeShortcutHelpBtn.addEventListener("click", function () {
            shortcutHelpPanel.classList.add("d-none");
        });

        shortcutHelpPanel.addEventListener("click", function (event) {
            if (event.target === shortcutHelpPanel) {
                shortcutHelpPanel.classList.add("d-none");
            }
        });
    }

    function initImageLoaded() {
        state.imageMeta.naturalWidth = mainImage.naturalWidth;
        state.imageMeta.naturalHeight = mainImage.naturalHeight;
        state.imageMeta.loaded = true;

        canvasContent.style.width = `${state.imageMeta.naturalWidth}px`;
        canvasContent.style.height = `${state.imageMeta.naturalHeight}px`;
        annotationLayer.style.width = `${state.imageMeta.naturalWidth}px`;
        annotationLayer.style.height = `${state.imageMeta.naturalHeight}px`;
        temporaryLayer.style.width = `${state.imageMeta.naturalWidth}px`;
        temporaryLayer.style.height = `${state.imageMeta.naturalHeight}px`;
        previewLayer.style.width = `${state.imageMeta.naturalWidth}px`;
        previewLayer.style.height = `${state.imageMeta.naturalHeight}px`;

        const imageState = getCurrentImageState();
        if (imageState) {
            imageState.width = state.imageMeta.naturalWidth;
            imageState.height = state.imageMeta.naturalHeight;
        }

        resetViewState();
        fitImageToViewport();
        renderAllAnnotationUi();

        const current = getCurrentImage();
        if (current) addLog(`图像已显示: ${current.relative_path}`);

        if (state.mode === "rect") {
            updateStageHint("矩形框模式：第一次点击记录起点，第二次点击完成成框");
        } else if (state.mode === "pan") {
            updateStageHint("手型拖动模式：按下鼠标左键拖动画布");
        } else {
            updateStageHint("选择模式：点击绿色正式框可选中，拖动框体可移动，拖动控制点可改变大小");
        }
    }

    function bindImageEvents() {
        mainImage.addEventListener("load", initImageLoaded);

        mainImage.addEventListener("error", function () {
            state.imageMeta.loaded = false;
            addLog("图像加载失败");
            showToast("图像加载失败", "error");
            updateStageHint("图像加载失败");
        });
    }

    function prepareInitData(result) {
        state.config = result.config || {};
        state.images = Array.isArray(result.images) ? result.images : [];
        state.imageStates = result.image_states && typeof result.image_states === "object" ? result.image_states : {};
        state.currentIndex = typeof result.current_index === "number" ? result.current_index : -1;
        state.nextAnnoId = typeof result.next_anno_id === "number"
            ? result.next_anno_id
            : Number(state.config.annotation_id_start || 1);

        initBatchSelectionDefault();

        if (result.batch_state) {
            updateBatchStatusUi(result.batch_state);
            if (result.batch_state.running) {
                state.batch.running = true;
                if (state.batch.timerId) {
                    window.clearInterval(state.batch.timerId);
                }
                state.batch.timerId = window.setInterval(pollBatchStatus, 1500);
            }
        }
    }

    async function initPage() {
        try {
            const result = await safeFetchJson("/api/annotate/init", {}, "初始化失败");

            if (!result.success) {
                addLog(result.message || "初始化失败");
                showToast(result.message || "初始化失败", "error");
                return;
            }

            prepareInitData(result);
            renderToolbar();
            renderCategories();
            renderAutoApiSummary();
            renderBatchImageList();
            updateModeUi();
            updateToolbarLinkedState();
            await updateImageDisplay();

            if (state.images.length > 0) {
                addLog(`已加载 ${state.images.length} 张图像`);
                showToast(`已加载 ${state.images.length} 张图像`, "success");
            } else {
                addLog("未扫描到图像，请检查设置页中的图像目录");
                showToast("未扫描到图像", "error");
            }
        } catch (error) {
            addLog(`初始化异常: ${error.message}`);
            showToast(error.message, "error");
        }
    }

    prevImageBtn.addEventListener("click", showPrevImage);
    nextImageBtn.addEventListener("click", showNextImage);

    window.addEventListener("resize", function () {
        if (state.imageMeta.loaded) {
            fitImageToViewport();
        }
    });

    bindTopAndBottomButtons();
    bindStageEvents();
    bindKeyboardShortcuts();
    bindEditorEvents();
    bindHelpPanelEvents();
    bindImageEvents();
    initTabs();
    initPage();
})();
