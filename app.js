// デフォルトプリセット（25%刻み）
const DEFAULT_PRESETS = [
    { name: '25% - 最軽量', quality: 25 },
    { name: '50% - 軽量', quality: 50 },
    { name: '75% - 標準', quality: 75 },
    { name: '100% - 高品質', quality: 100 }
];

const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/bmp'
]);

const SUPPORTED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'
]);

const SUPPORTED_FORMATS_LABEL = 'PNG / JPEG / WebP / GIF / AVIF / BMP';

const OUTPUT_FORMATS = {
    jpeg: { mime: 'image/jpeg', ext: '.jpg', label: 'JPG' },
    webp: { mime: 'image/webp', ext: '.webp', label: 'WebP' }
};

const OUTPUT_FORMAT_STORAGE_KEY = 'png2jpg_output_format';

let editablePresets = [...DEFAULT_PRESETS];
let uploadedFiles = [];
let conversionResults = [];
let previewUrls = [];
let outputFormat = 'jpeg';
let webpEncodeSupported = false;

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
    loadPresetsFromStorage();
    loadOutputFormatFromStorage();
    webpEncodeSupported = await detectWebpEncodeSupport();
    renderPresetList();
    renderPresetEditor();
    setupOutputFormatSelector();
    setupDragAndDrop();
    setupFileInput();
    setupPreviewContextMenu();
});

// ===== ドラッグ&ドロップ処理 =====
function setupDragAndDrop() {
    const zone = document.getElementById('dropZone');

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function setupFileInput() {
    document.getElementById('fileInput').addEventListener('change', (e) => {
        handleFiles(e.target.files);
        e.target.value = '';
    });
}

async function handleFiles(files) {
    const imageFiles = Array.from(files).filter(isSupportedImageFile);

    if (imageFiles.length === 0) {
        showStatus(`${SUPPORTED_FORMATS_LABEL} の画像のみ対応です`, 'error');
        return;
    }

    if (imageFiles.length < files.length) {
        showStatus(`${files.length - imageFiles.length}件をスキップしました（非対応形式）`, 'info');
    }

    uploadedFiles = imageFiles;
    await refreshConversions();
}

function getFileExtension(filename) {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function isSupportedImageFile(file) {
    if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
        return true;
    }

    if (!file.type || file.type === 'application/octet-stream') {
        return SUPPORTED_EXTENSIONS.has(getFileExtension(file.name));
    }

    return false;
}

function getSelectedPresetIndices() {
    return Array.from(document.querySelectorAll('.preset-list input[type="checkbox"]:checked'))
        .map((checkbox) => parseInt(checkbox.dataset.presetIdx, 10));
}

async function refreshConversions() {
    if (uploadedFiles.length === 0) {
        return;
    }

    const presetIndices = getSelectedPresetIndices();
    if (presetIndices.length === 0) {
        revokePreviewUrls();
        conversionResults = [];
        clearPreview();
        displayResults();
        showStatus('実行するプリセットを選択してください', 'error');
        return;
    }

    await runConversions(uploadedFiles, presetIndices);
}

function getOutputFormatConfig() {
    return OUTPUT_FORMATS[outputFormat];
}

function buildOutputFilename(baseName, quality) {
    const { ext } = getOutputFormatConfig();
    return `${baseName}_${quality}pct${ext}`;
}

async function detectWebpEncodeSupport() {
    if (typeof document.createElement('canvas').toBlob !== 'function') {
        return false;
    }

    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.toBlob((blob) => resolve(Boolean(blob)), 'image/webp', 0.8);
    });
}

function setupOutputFormatSelector() {
    const webpRadio = document.querySelector('input[name="outputFormat"][value="webp"]');
    const note = document.getElementById('webpUnsupportedNote');

    if (!webpEncodeSupported) {
        webpRadio.disabled = true;
        note.hidden = false;
        if (outputFormat === 'webp') {
            outputFormat = 'jpeg';
            saveOutputFormatToStorage();
        }
    }

    document.querySelectorAll('input[name="outputFormat"]').forEach((radio) => {
        radio.checked = radio.value === outputFormat;
        radio.addEventListener('change', async (e) => {
            if (!e.target.checked) {
                return;
            }
            outputFormat = e.target.value;
            saveOutputFormatToStorage();
            if (uploadedFiles.length > 0) {
                await refreshConversions();
            }
        });
    });
}

async function runConversions(files, presetIndices) {
    revokePreviewUrls();
    conversionResults = [];
    const usedFilenames = new Set();

    showStatus(`処理中: ${files.length}個のファイル × ${presetIndices.length}パターン`, 'info');

    try {
        for (const file of files) {
            for (const idx of presetIndices) {
                const preset = editablePresets[idx];
                const blob = await convertImage(file, outputFormat, preset.quality);
                const filename = ensureUniqueFilename(
                    buildOutputFilename(getBaseName(file.name), preset.quality),
                    usedFilenames
                );

                conversionResults.push({
                    sourceName: file.name,
                    presetName: preset.name,
                    quality: preset.quality,
                    blob,
                    filename,
                    originalSize: file.size,
                    convertedSize: blob.size,
                    compressionRate: ((1 - blob.size / file.size) * 100).toFixed(1)
                });
            }
        }

        displayPreview(files);
        displayResults();
        showStatus(`✅ 変換完了: ${conversionResults.length}個のファイル`, 'success');
    } catch (error) {
        showStatus(`❌ エラー: ${error.message}`, 'error');
    }
}

function getBaseName(filename) {
    const ext = getFileExtension(filename);
    if (SUPPORTED_EXTENSIONS.has(ext)) {
        return filename.slice(0, -ext.length);
    }
    return filename.replace(/\.[^.]+$/, '');
}

function ensureUniqueFilename(filename, usedSet) {
    if (!usedSet.has(filename)) {
        usedSet.add(filename);
        return filename;
    }

    const ext = getFileExtension(filename);
    if (!ext) {
        usedSet.add(filename);
        return filename;
    }

    const base = filename.slice(0, -ext.length);
    let counter = 2;

    while (usedSet.has(`${base}_${counter}${ext}`)) {
        counter += 1;
    }

    const uniqueName = `${base}_${counter}${ext}`;
    usedSet.add(uniqueName);
    return uniqueName;
}

// ===== Canvas変換処理 =====
function convertImage(file, formatKey, quality) {
    const format = OUTPUT_FORMATS[formatKey];

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error(`${format.label}変換に失敗しました`));
                            return;
                        }
                        resolve(blob);
                    },
                    format.mime,
                    quality / 100
                );
            };

            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.src = e.target.result;
        };

        reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
        reader.readAsDataURL(file);
    });
}

// ===== プレビュー表示 =====
function escapeHtmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function renderPreviewImageLink(url, filename, alt) {
    const safeUrl = escapeHtmlAttr(url);
    const safeFilename = escapeHtmlAttr(filename);
    const safeAlt = escapeHtmlAttr(alt);

    return `
        <a class="preview-image-link"
           href="${safeUrl}"
           download="${safeFilename}">
            <img src="${safeUrl}" alt="${safeAlt}" loading="lazy">
        </a>
    `;
}

let previewContextMenu = null;
let previewContextTarget = null;

function setupPreviewContextMenu() {
    const previewList = document.getElementById('previewList');

    previewContextMenu = document.createElement('div');
    previewContextMenu.id = 'previewContextMenu';
    previewContextMenu.className = 'preview-context-menu';
    previewContextMenu.hidden = true;
    previewContextMenu.innerHTML = `
        <button type="button" data-action="save">名前を付けて保存</button>
    `;
    document.body.appendChild(previewContextMenu);

    previewList.addEventListener('contextmenu', (e) => {
        const link = e.target.closest('.preview-image-link');
        if (!link) {
            return;
        }

        e.preventDefault();
        previewContextTarget = link;
        previewContextMenu.hidden = false;
        previewContextMenu.style.left = `${e.clientX}px`;
        previewContextMenu.style.top = `${e.clientY}px`;
    });

    previewList.addEventListener('click', (e) => {
        const link = e.target.closest('.preview-image-link');
        if (!link) {
            return;
        }
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
        }
        e.preventDefault();
    });

    previewContextMenu.addEventListener('click', async (e) => {
        const action = e.target.closest('button[data-action="save"]');
        if (!action || !previewContextTarget) {
            return;
        }

        const url = previewContextTarget.href;
        const filename = previewContextTarget.getAttribute('download')
            || `image${getOutputFormatConfig().ext}`;
        const response = await fetch(url);
        downloadBlob(await response.blob(), filename);

        hidePreviewContextMenu();
    });

    document.addEventListener('click', hidePreviewContextMenu);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hidePreviewContextMenu();
        }
    });
}

function hidePreviewContextMenu() {
    if (!previewContextMenu) {
        return;
    }
    previewContextMenu.hidden = true;
    previewContextTarget = null;
}

function displayPreview(files) {
    const container = document.getElementById('previewList');

    container.innerHTML = files.map((file) => {
        const previewResults = conversionResults.filter((result) => result.sourceName === file.name);
        const originalUrl = URL.createObjectURL(file);
        previewUrls.push(originalUrl);

        const convertedHtml = previewResults.map((result) => {
            const url = URL.createObjectURL(result.blob);
            previewUrls.push(url);
            const label = getPresetDisplayLabel(result.presetName, result.quality);

            return `
                <div class="preview-converted-item">
                    <p class="preview-preset-name">${label}</p>
                    ${renderPreviewImageLink(url, result.filename, label)}
                    <p>${(result.convertedSize / 1024).toFixed(2)} KB</p>
                    <p>圧縮率: ${result.compressionRate}%</p>
                </div>
            `;
        }).join('');

        return `
            <div class="preview-file-row">
                <div class="preview-original">
                    <h4>元画像</h4>
                    ${renderPreviewImageLink(originalUrl, file.name, file.name)}
                    <p class="preview-filename">${file.name}</p>
                    <p>${(file.size / 1024).toFixed(2)} KB</p>
                </div>
                <div class="preview-converted-section">
                    <h4>変換済み（選択プリセット）</h4>
                    <div class="preview-converted-grid">${convertedHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('previewContainer').style.display = 'flex';
}

function clearPreview() {
    document.getElementById('previewList').innerHTML = '';
    document.getElementById('previewContainer').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
}

function revokePreviewUrls() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
}

// ===== 結果表示 =====
function displayResults() {
    const showSourceColumn = uploadedFiles.length > 1;
    const thead = document.getElementById('resultsTableHead');

    thead.innerHTML = showSourceColumn
        ? `
            <th>元ファイル</th>
            <th>プリセット</th>
            <th>品質</th>
            <th>出力ファイル名</th>
            <th>元サイズ</th>
            <th>変換後</th>
            <th>圧縮率</th>
        `
        : `
            <th>プリセット</th>
            <th>品質</th>
            <th>出力ファイル名</th>
            <th>元サイズ</th>
            <th>変換後</th>
            <th>圧縮率</th>
        `;

    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = conversionResults.map((result) => {
        const commonCells = `
            <td>${result.presetName}</td>
            <td>${result.quality}%</td>
            <td>${result.filename}</td>
            <td>${(result.originalSize / 1024).toFixed(2)} KB</td>
            <td>${(result.convertedSize / 1024).toFixed(2)} KB</td>
            <td>${result.compressionRate}%</td>
        `;

        return showSourceColumn
            ? `<tr><td>${result.sourceName}</td>${commonCells}</tr>`
            : `<tr>${commonCells}</tr>`;
    }).join('');

    document.getElementById('resultsSection').style.display =
        conversionResults.length > 0 ? 'block' : 'none';
}

// ===== 一括ダウンロード =====
function getZipFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const date = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `converted-images-${date}-${time}.zip`;
}

async function downloadAll() {
    if (conversionResults.length === 0) {
        showStatus('変換結果がありません', 'error');
        return;
    }

    if (typeof JSZip === 'undefined') {
        showStatus('❌ JSZip の読み込みに失敗しました。ネットワーク接続を確認してください', 'error');
        return;
    }

    showStatus('ダウンロード準備中...', 'info');

    const zip = new JSZip();

    conversionResults.forEach((result) => {
        zip.file(result.filename, result.blob);
    });

    try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(zipBlob, getZipFilename());
        showStatus(`✅ ダウンロード完了（${conversionResults.length}ファイル）`, 'success');
    } catch (error) {
        showStatus(`❌ ダウンロード失敗: ${error.message}`, 'error');
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ===== プリセット管理 =====
function getPresetDisplayLabel(name, quality) {
    const suffix = name.replace(/^\d+%\s*-\s*/, '');
    if (suffix !== name) {
        return `${quality}% - ${suffix}`;
    }
    return `${name} (${quality}%)`;
}

function syncPresetNameQuality(preset) {
    if (/^\d+%/.test(preset.name)) {
        preset.name = preset.name.replace(/^\d+%/, `${preset.quality}%`);
    }
}

function renderPresetList() {
    const container = document.getElementById('presetList');
    const previouslyChecked = new Set(
        Array.from(container.querySelectorAll('input:checked')).map((cb) => parseInt(cb.dataset.presetIdx, 10))
    );
    const isFirstRender = container.children.length === 0;

    container.innerHTML = editablePresets.map((preset, idx) => {
        const checked = isFirstRender || previouslyChecked.has(idx) ? 'checked' : '';
        return `
        <label class="preset-option">
            <input type="checkbox" data-preset-idx="${idx}" ${checked}
                   onchange="refreshConversions()">
            <span>${getPresetDisplayLabel(preset.name, preset.quality)}</span>
        </label>
    `;
    }).join('');
}

function renderPresetEditor() {
    const container = document.getElementById('presetEditor');
    container.innerHTML = editablePresets.map((preset, idx) => `
        <div class="preset-edit-row">
            <input type="text"
                   value="${preset.name}"
                   onchange="updatePresetName(${idx}, this.value)">
            <div class="quality-input">
                <input type="range" min="10" max="100" step="5"
                       value="${preset.quality}"
                       onchange="updatePresetQuality(${idx}, this.value)">
                <input type="number" min="10" max="100" step="5"
                       value="${preset.quality}"
                       onchange="updatePresetQuality(${idx}, this.value)">
                <span>%</span>
            </div>
        </div>
    `).join('');
}

function updatePresetName(idx, name) {
    editablePresets[idx].name = name;
    savePresetsToStorage();
    renderPresetList();
    if (uploadedFiles.length > 0) {
        refreshConversions();
    }
}

function updatePresetQuality(idx, quality) {
    editablePresets[idx].quality = parseInt(quality, 10);
    syncPresetNameQuality(editablePresets[idx]);
    savePresetsToStorage();
    renderPresetList();
    renderPresetEditor();
    if (uploadedFiles.length > 0) {
        refreshConversions();
    }
}

function resetPresets() {
    if (confirm('プリセットをデフォルトにリセットしますか？')) {
        editablePresets = [...DEFAULT_PRESETS];
        savePresetsToStorage();
        renderPresetList();
        renderPresetEditor();
        if (uploadedFiles.length > 0) {
            refreshConversions();
        }
        showStatus('✅ プリセットをリセットしました', 'success');
    }
}

// ===== LocalStorage =====
function saveOutputFormatToStorage() {
    localStorage.setItem(OUTPUT_FORMAT_STORAGE_KEY, outputFormat);
}

function loadOutputFormatFromStorage() {
    const saved = localStorage.getItem(OUTPUT_FORMAT_STORAGE_KEY);
    if (saved && OUTPUT_FORMATS[saved]) {
        outputFormat = saved;
    }
}

function savePresetsToStorage() {
    localStorage.setItem('png2jpg_presets', JSON.stringify(editablePresets));
}

function loadPresetsFromStorage() {
    const saved = localStorage.getItem('png2jpg_presets');
    if (saved) {
        editablePresets = JSON.parse(saved);
        editablePresets.forEach(syncPresetNameQuality);
    }
}

// ===== ステータス表示 =====
function showStatus(message, type) {
    const el = document.getElementById('statusMessage');
    el.textContent = message;
    el.className = `status-message ${type}`;
    el.style.display = 'block';

    if (type !== 'error') {
        setTimeout(() => {
            el.style.display = 'none';
        }, 3000);
    }
}
