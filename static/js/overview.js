(function () {
    const overviewGrid = document.getElementById("overview-grid");
    const emptyBox = document.getElementById("overview-empty-box");
    const countText = document.getElementById("overview-count-text");
    const refreshBtn = document.getElementById("refresh-overview-btn");
    const searchInput = document.getElementById("overview-search-input");

    const state = {
        images: [],
        filteredImages: []
    };

    function escapeHtml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function safeFetchJson(url, options = {}, errorPrefix = "请求失败") {
        const response = await fetch(url, options);
        let result = null;

        try {
            result = await response.json();
        } catch (error) {
            throw new Error(`${errorPrefix}：服务端返回的不是合法 JSON`);
        }

        if (!response.ok) {
            throw new Error(result.message || `${errorPrefix}：HTTP ${response.status}`);
        }

        return result;
    }

    function formatImageSize(item) {
        const width = Number(item.width || 0);
        const height = Number(item.height || 0);
        if (width > 0 && height > 0) {
            return `${width} × ${height}`;
        }
        return "未知尺寸";
    }

    function buildCardHtml(item) {
        const name = escapeHtml(item.name || "");
        const relativePath = escapeHtml(item.relative_path || "");
        const imageUrl = escapeHtml(item.url || "");
        const sizeText = escapeHtml(formatImageSize(item));
        const startUrl = `/annotate?start_image=${encodeURIComponent(item.relative_path || "")}`;

        return `
            <div class="col-12 col-sm-6 col-md-4 col-xl-3">
                <div class="card border-0 shadow-sm h-100 overview-image-card">
                    <div class="card-body d-flex flex-column">
                        <div class="overview-thumb-wrap mb-3">
                            <img src="${imageUrl}" alt="${name}" class="overview-thumb">
                        </div>

                        <div class="overview-image-name mb-2">${name}</div>

                        <div class="small text-secondary mb-1">相对路径</div>
                        <div class="small overview-image-path text-secondary mb-2">${relativePath}</div>

                        <div class="small text-secondary mb-3">尺寸：${sizeText}</div>

                        <div class="mt-auto d-grid">
                            <a class="btn btn-primary btn-sm" href="${startUrl}">进入标注</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderImages() {
        const images = state.filteredImages;
        countText.textContent = `共 ${images.length} 张图片`;

        if (!images.length) {
            overviewGrid.innerHTML = "";
            emptyBox.classList.remove("d-none");
            return;
        }

        emptyBox.classList.add("d-none");
        overviewGrid.innerHTML = images.map(buildCardHtml).join("");
    }

    function applyFilter() {
        const keyword = (searchInput.value || "").trim().toLowerCase();

        if (!keyword) {
            state.filteredImages = [...state.images];
            renderImages();
            return;
        }

        state.filteredImages = state.images.filter((item) => {
            const name = String(item.name || "").toLowerCase();
            const relativePath = String(item.relative_path || "").toLowerCase();
            return name.includes(keyword) || relativePath.includes(keyword);
        });

        renderImages();
    }

    async function loadImages() {
        overviewGrid.innerHTML = "";
        emptyBox.classList.add("d-none");
        countText.textContent = "加载中...";

        try {
            const result = await safeFetchJson("/api/images", {}, "加载图片列表失败");
            if (!result.success) {
                throw new Error(result.message || "加载图片列表失败");
            }

            state.images = Array.isArray(result.images) ? result.images : [];
            state.filteredImages = [...state.images];
            applyFilter();
        } catch (error) {
            state.images = [];
            state.filteredImages = [];
            countText.textContent = "加载失败";
            overviewGrid.innerHTML = "";
            emptyBox.classList.remove("d-none");
            emptyBox.innerHTML = `
                <div>
                    <div class="mb-2">加载图片列表失败</div>
                    <div class="small">${escapeHtml(error.message)}</div>
                </div>
            `;
        }
    }

    refreshBtn.addEventListener("click", loadImages);
    searchInput.addEventListener("input", applyFilter);

    loadImages();
})();