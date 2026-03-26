// static/js/settings.js
(function () {
    const messageBox = document.getElementById("settings-message");
    const saveBtn = document.getElementById("save-btn");
    const saveAndStartBtn = document.getElementById("save-and-start-btn");

    const imageDirInput = document.getElementById("image_dir");
    const outputDirInput = document.getElementById("output_dir");
    const imageIdStartInput = document.getElementById("image_id_start");
    const annotationIdStartInput = document.getElementById("annotation_id_start");
    const bboxLineWidthInput = document.getElementById("bbox_line_width");
    const categoriesJsonInput = document.getElementById("categories_json");
    const autoAnnotateApiUrlInput = document.getElementById("auto_annotate_api_url");
    const autoAnnotateTokenInput = document.getElementById("auto_annotate_token");
    const autoAnnotateRequestTypeInput = document.getElementById("auto_annotate_request_type");
    const toolbarOptionsContainer = document.getElementById("toolbar-options");

    function setMessage(text, type = "") {
        messageBox.textContent = text;
        messageBox.className = "mt-3 small";
        if (type) {
            messageBox.classList.add(type);
        }
    }

    function getSelectedToolbarTools() {
        const checkboxes = toolbarOptionsContainer.querySelectorAll('input[type="checkbox"]');
        const tools = [];
        checkboxes.forEach((checkbox) => {
            if (checkbox.checked) {
                tools.push(checkbox.value);
            }
        });
        return tools;
    }

    function setSelectedToolbarTools(tools) {
        const toolSet = new Set(Array.isArray(tools) ? tools : []);
        const checkboxes = toolbarOptionsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox) => {
            checkbox.checked = toolSet.has(checkbox.value);
        });
    }

    function fillForm(config) {
        imageDirInput.value = config.image_dir || "";
        outputDirInput.value = config.output_dir || "";
        imageIdStartInput.value = config.image_id_start ?? 1;
        annotationIdStartInput.value = config.annotation_id_start ?? 1;
        bboxLineWidthInput.value = config.bbox_line_width ?? 2;
        categoriesJsonInput.value = JSON.stringify(config.categories || [], null, 2);
        autoAnnotateApiUrlInput.value = config.auto_annotate_api_url || "";
        autoAnnotateTokenInput.value = config.auto_annotate_token || "";
        autoAnnotateRequestTypeInput.value = config.auto_annotate_request_type || "path";
        setSelectedToolbarTools(config.toolbar_tools || []);
    }

    async function loadConfig() {
        try {
            const response = await fetch("/api/config");
            const result = await response.json();
            if (!result.success) {
                setMessage(result.message || "加载配置失败", "error");
                return;
            }
            fillForm(result.config);
        } catch (error) {
            setMessage(`加载配置失败: ${error.message}`, "error");
        }
    }

    function buildPayload() {
        let categories;
        try {
            categories = JSON.parse(categoriesJsonInput.value);
        } catch (error) {
            throw new Error("categories JSON 格式不正确");
        }

        return {
            image_dir: imageDirInput.value.trim(),
            output_dir: outputDirInput.value.trim(),
            categories: categories,
            image_id_start: Number(imageIdStartInput.value),
            annotation_id_start: Number(annotationIdStartInput.value),
            bbox_line_width: Number(bboxLineWidthInput.value),
            toolbar_tools: getSelectedToolbarTools(),
            auto_annotate_api_url: autoAnnotateApiUrlInput.value.trim(),
            auto_annotate_token: autoAnnotateTokenInput.value.trim(),
            auto_annotate_request_type: autoAnnotateRequestTypeInput.value
        };
    }

    async function saveConfig(redirectAfterSave = false) {
        setMessage("");

        let payload;
        try {
            payload = buildPayload();
        } catch (error) {
            setMessage(error.message, "error");
            return;
        }

        try {
            const response = await fetch("/api/config", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!result.success) {
                setMessage(result.message || "保存失败", "error");
                return;
            }

            setMessage(result.message || "保存成功", "success");

            if (redirectAfterSave && result.redirect_url) {
                window.location.href = result.redirect_url;
            }
        } catch (error) {
            setMessage(`保存失败: ${error.message}`, "error");
        }
    }

    saveBtn.addEventListener("click", function () {
        saveConfig(false);
    });

    saveAndStartBtn.addEventListener("click", function () {
        saveConfig(true);
    });

    loadConfig();
})();