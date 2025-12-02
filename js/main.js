import { connectPrinter, printImage, getBatteryLevel, isPrinterConnected, getLastKnownBatteryLevel } from './printer.js';
// The original receiptRenderer is no longer used, but we keep the import reference if needed elsewhere.
// import { renderReceipt, updateReceiptPreview } from './receiptRenderer.js'; 
import { logger, setupLoggerUI } from './logger.js';
import * as imageProcessor from './imageProcessor.js';

// === DOM Elements ===
// Mode toggle
const receiptModeBtn = document.getElementById('receiptModeBtn');
const imageModeBtn = document.getElementById('imageModeBtn');
const receiptModeContent = document.getElementById('receiptModeContent');
const imageModeContent = document.getElementById('imageModeContent');

// Battery indicator elements
const batteryIndicator = document.getElementById('batteryIndicator');
const batteryLevel = document.getElementById('batteryLevel');
const batteryIcon = document.querySelector('.battery-icon');

// Text Mode Elements (Replaces Receipt Mode)
const plainTextToPrintInput = document.getElementById('plainTextToPrint');
const textPreviewCanvas = document.getElementById('textPreviewCanvas');
const textSummary = document.getElementById('textSummary');

// Buttons
const connectReceiptBtn = document.getElementById('connectReceiptBtn');
const printReceiptBtn = document.getElementById('printReceiptBtn');

// Image Mode Elements (Kept as is)
const imageUploadInput = document.getElementById('imageUpload');
const ditherMethodSelect = document.getElementById('ditherMethod');
const thresholdValueInput = document.getElementById('thresholdValue');
const thresholdDisplay = document.getElementById('thresholdDisplay');
const imageInvertInput = document.getElementById('imageInvert');
const imageWidthInput = document.getElementById('imageWidth');
const autoscaleImageInput = document.getElementById('autoscaleImage');
const imagePaddingInput = document.getElementById('imagePadding');
const rotateLeftBtn = document.getElementById('rotateLeftBtn');
const rotateRightBtn = document.getElementById('rotateRightBtn');
const rotationDisplay = document.getElementById('rotationDisplay');
const connectImageBtn = document.getElementById('connectImageBtn');
const resetImageBtn = document.getElementById('resetImageBtn');
const printImageBtn = document.getElementById('printImageBtn');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewMessage = document.getElementById('imagePreviewMessage');
const imageSummary = document.getElementById('imageSummary');

// Logger UI elements
const logWrapper = document.getElementById('logWrapper');
const clearLogBtn = document.getElementById('clearLogBtn');
const printProgressBar = document.getElementById('printProgressBar');

// === Data Store ===
let currentMode = 'receipt'; // 'receipt' is now 'text' mode

// === Battery Level Timer ===
let batteryCheckIntervalId = null;
const BATTERY_CHECK_INTERVAL = 30000; // 30 seconds

// === Text to Canvas Logic ===

/**
 * Renders plain text onto the canvas element for the text preview.
 * @param {string} text - The text to render, supporting \n for new lines.
 * @param {number} printerWidth - The fixed width of the printer (384px).
 */
function renderTextToCanvas(text, printerWidth = 384) {
    const canvas = textPreviewCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Printer is 384px wide
    const padding = 10;
    const fontSize = 24; 
    const font = `${fontSize}px monospace`; 
    const lineHeight = fontSize * 1.3;
    const maxWidth = printerWidth - padding * 2;
    
    ctx.font = font;
    
    const rawLines = text.split('\n');
    let wrappedLines = [];

    // Simple word wrapping logic
    for (const rawLine of rawLines) {
        let currentLine = '';
        const words = rawLine.split(' ');

        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + words[i] + ' ';
            const testWidth = ctx.measureText(testLine).width;

            // If line exceeds width (and it's not the first word of the line), wrap it
            if (testWidth > maxWidth && i > 0) {
                wrappedLines.push(currentLine.trim());
                currentLine = words[i] + ' ';
            } else {
                currentLine = testLine;
            }
        }
        wrappedLines.push(currentLine.trim());
    }

    // Set Final Canvas Dimensions and Draw
    canvas.width = printerWidth;
    canvas.height = (wrappedLines.length * lineHeight) + padding * 2;
    
    // Fill background with WHITE (crucial for correct thermal printing)
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the Black Text
    ctx.fillStyle = 'black';
    ctx.font = font;
    ctx.textBaseline = 'top';

    wrappedLines.forEach((line, index) => {
        const y = padding + (index * lineHeight);
        ctx.fillText(line, padding, y);
    });
    
    // Update the summary panel
    if (textSummary) {
        textSummary.innerHTML = `
            <div class="summary-section">
                <div class="summary-row">
                    <span>Total Lines:</span> <span>${wrappedLines.length}</span>
                </div>
                <div class="summary-row">
                    <span>Print Height:</span> <span>${canvas.height} px</span>
                </div>
                <div class="summary-row">
                    <span>Characters:</span> <span>${text.length}</span>
                </div>
            </div>`;
    }
    
    return canvas;
}

// Handler for the Print Text button
async function handlePrintText() {
    const text = plainTextToPrintInput.value;
    
    if (!text || text.trim() === '') {
        logger.warn('No text to print');
        showPrintingStatus('Please enter text to print', 'error');
        setTimeout(() => hidePrintingStatus(), 3000);
        return;
    }
    
    try {
        if (!isPrinterConnected()) {
            logger.warn('Printer not connected');
            showPrintingStatus('Please connect to printer first', 'error');
            setTimeout(() => hidePrintingStatus(), 3000);
            return;
        }
        
        showPrintingStatus('Preparing text for printing...');
        logger.info('Starting text print job');
        
        // 1. Convert text to canvas (This creates the image bitmap)
        const canvas = renderTextToCanvas(text); 
        
        // 2. Call the existing printImage function (which handles dithering, encoding, and BLE transfer)
        await printImage(canvas);
        
        showPrintingStatus('Text printed successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Text Print error:', err);
        logger.error('Print error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}


// === Initialize ===
function init() {
    // Add listener for real-time text-to-canvas preview update
    if (plainTextToPrintInput) {
        plainTextToPrintInput.addEventListener('input', () => {
            renderTextToCanvas(plainTextToPrintInput.value);
        });
        // Initial render if text is already present (e.g. from refresh)
        renderTextToCanvas(plainTextToPrintInput.value || '');
    }
    
    // Initialize logger UI
    initLoggerUI();
    
    // Initialize mode toggle
    setupModeToggle();
    
    // Set up image mode listeners
    setupImageModeListeners();
    
    // Set up connect buttons
    setupConnectButtons();
    
    // Initialize print buttons (disabled by default)
    updatePrintButtonState();
}

// Initialize the logger UI
function initLoggerUI() {
    // Set up the logger UI
    setupLoggerUI(logWrapper, printProgressBar);
    
    // Add clear log button event listener
    clearLogBtn.addEventListener('click', () => {
        logger.clear();
        logger.info('Log cleared');
    });
}

// Setup mode toggle functionality
function setupModeToggle() {
    receiptModeBtn.addEventListener('click', () => {
        setActiveMode('receipt');
    });
    
    imageModeBtn.addEventListener('click', () => {
        setActiveMode('image');
    });
    
    // Initialize with receipt mode active
    setActiveMode('receipt');
}

// Set the active mode (receipt/text or image)
function setActiveMode(mode) {
    currentMode = mode;
    
    // Update button states
    receiptModeBtn.classList.toggle('active', mode === 'receipt');
    imageModeBtn.classList.toggle('active', mode === 'image');
    
    // Update content visibility
    receiptModeContent.classList.toggle('active', mode === 'receipt');
    imageModeContent.classList.toggle('active', mode === 'image');
    
    // Update UI specific to the mode
    if (mode === 'receipt') {
        // Render the text preview on mode switch
        if (plainTextToPrintInput) {
            renderTextToCanvas(plainTextToPrintInput.value);
        }
    } else {
        updateImagePreview();
    }
    
    // Change printing status style based on mode
    document.documentElement.style.setProperty('--printing-status-color', 
        mode === 'receipt' ? '#3182ce' : '#c53030');
}

// Setup image mode event listeners (Retained from original code)
function setupImageModeListeners() {
    // Image upload
    imageUploadInput.addEventListener('change', handleImageUpload);
    
    // Drag and Drop functionality
    setupDragAndDrop();
    
    // Dither method change
    ditherMethodSelect.addEventListener('change', () => {
        imageProcessor.updateSettings({ ditherMethod: ditherMethodSelect.value });
        updateImagePreview();
    });
    
    // Threshold value change
    thresholdValueInput.addEventListener('input', () => {
        const threshold = parseInt(thresholdValueInput.value);
        thresholdDisplay.textContent = threshold;
        imageProcessor.updateSettings({ threshold });
        updateImagePreview();
    });
    
    // Invert toggle
    imageInvertInput.addEventListener('change', () => {
        imageProcessor.updateSettings({ invert: imageInvertInput.checked });
        updateImagePreview();
    });
    
    // Width change
    imageWidthInput.addEventListener('change', () => {
        let width = parseInt(imageWidthInput.value);
        if (width < 1) width = 1;
        if (width > 384) width = 384;
        imageWidthInput.value = width;
        imageProcessor.updateSettings({ width });
        updateImagePreview();
    });
    
    // Auto-scale toggle
    autoscaleImageInput.addEventListener('change', () => {
        imageProcessor.updateSettings({ autoscale: autoscaleImageInput.checked });
        updateImagePreview();
    });
    
    // Padding change
    imagePaddingInput.addEventListener('change', () => {
        let padding = parseInt(imagePaddingInput.value);
        if (padding < 0) padding = 0;
        if (padding > 100) padding = 100;
        imagePaddingInput.value = padding;
        imageProcessor.updateSettings({ padding });
        updateImagePreview();
    });
    
    // Rotate left button (counter-clockwise)
    rotateLeftBtn.addEventListener('click', () => {
        const settings = imageProcessor.getSettings();
        // Calculate new rotation (0, 90, 180, 270) with wrap-around
        let newRotation = (settings.rotation - 90) % 360;
        if (newRotation < 0) newRotation += 360;
        
        imageProcessor.updateSettings({ rotation: newRotation });
        rotationDisplay.textContent = `${newRotation}°`;
        logger.info(`Image rotated to ${newRotation}°`);
        updateImagePreview();
    });
    
    // Rotate right button (clockwise)
    rotateRightBtn.addEventListener('click', () => {
        const settings = imageProcessor.getSettings();
        // Calculate new rotation (0, 90, 180, 270) with wrap-around
        const newRotation = (settings.rotation + 90) % 360;
        
        imageProcessor.updateSettings({ rotation: newRotation });
        rotationDisplay.textContent = `${newRotation}°`;
        logger.info(`Image rotated to ${newRotation}°`);
        updateImagePreview();
    });
    
    // Reset image settings
    resetImageBtn.addEventListener('click', resetImageSettings);
    
    // Print image
    printImageBtn.addEventListener('click', printProcessedImage);
}

// === Drag and Drop Functionality (Retained from original code) ===
function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    
    // Prevent the default behavior for these events to enable dropping
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Handle enter and over events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });
    
    // Handle leave and drop events
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });
    
    // Add and remove highlight class
    function highlight() {
        dropZone.classList.add('drag-over');
    }
    
    function unhighlight() {
        dropZone.classList.remove('drag-over');
    }
    
    // Handle the drop event
    dropZone.addEventListener('drop', handleDrop, false);
    
    async function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files && files.length > 0) {
            const file = files[0];
            
            // Check if the file is an image
            if (!file.type.match('image.*')) {
                logger.warn('File is not an image');
                imagePreviewMessage.textContent = 'Error: Please upload an image file';
                return;
            }
            
            logger.info(`Processing dropped image: ${file.name}`, {
                type: file.type,
                size: `${Math.round(file.size / 1024)} KB`
            });
            
            // Show loading state
            imagePreviewMessage.textContent = 'Loading image...';
            imagePreview.style.display = 'none';
            
            try {
                // Load the image
                await imageProcessor.loadImage(file);
                
                // Update the preview
                updateImagePreview();
            } catch (err) {
                logger.error('Error processing dropped image', { message: err.message });
                imagePreviewMessage.textContent = `Error: ${err.message}`;
            }
        }
    }
}

// Handle image upload (Retained from original code)
async function handleImageUpload() {
    try {
        if (!imageUploadInput.files || !imageUploadInput.files[0]) {
            return;
        }
        
        const file = imageUploadInput.files[0];
        logger.info(`Processing uploaded image: ${file.name}`, {
            type: file.type,
            size: `${Math.round(file.size / 1024)} KB`
        });
        
        // Show loading state
        imagePreviewMessage.textContent = 'Loading image...';
        imagePreview.style.display = 'none';
        
        // Load the image
        await imageProcessor.loadImage(file);
        
        // Update the preview
        updateImagePreview();
        
    } catch (err) {
        logger.error('Error uploading image', { message: err.message });
        imagePreviewMessage.textContent = `Error: ${err.message}`;
    }
}

// Update the image preview (Retained from original code)
function updateImagePreview() {
    const canvas = imageProcessor.processImage();
    
    if (!canvas) {
        imagePreview.style.display = 'none';
        imagePreviewMessage.style.display = 'block';
        imagePreviewMessage.textContent = 'Drop image here or click the upload button';
        imageSummary.innerHTML = '';
        return;
    }
    
    // Display processed image
    imagePreview.width = canvas.width;
    imagePreview.height = canvas.height;
    const ctx = imagePreview.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    
    imagePreview.style.display = 'block';
    imagePreviewMessage.style.display = 'none';
    
    // Update image summary
    updateImageSummary();
}

// Update the image summary panel (Retained from original code)
function updateImageSummary() {
    const summary = imageProcessor.getImageSummary();
    if (!summary) {
        imageSummary.innerHTML = '';
        return;
    }
    
    // Only show threshold for dither methods that use it
    const usesThreshold = ['threshold', 'floydSteinberg', 'atkinson', 'halftone'].includes(summary.ditherMethod);
    const thresholdRow = usesThreshold ? `
        <div class="summary-row">
            <span>Threshold:</span> <span>${summary.threshold}</span>
        </div>` : '';
    
    imageSummary.innerHTML = `
    <div class="summary-section">
        <div class="summary-row">
            <span>Original Size:</span> <span>${summary.originalWidth} × ${summary.originalHeight} px</span>
        </div>
        <div class="summary-row">
            <span>Print Size:</span> <span>${summary.processedWidth} × ${summary.processedHeight} px</span>
        </div>
        <div class="summary-row">
            <span>Aspect Ratio:</span> <span>${summary.aspectRatio}</span>
        </div>
    </div>
    <div class="summary-section">
        <div class="summary-row">
            <span>Dithering:</span> <span>${summary.ditherMethod}</span>
        </div>${thresholdRow}
        <div class="summary-row">
            <span>Inverted:</span> <span>${summary.invert ? 'Yes' : 'No'}</span>
        </div>
        <div class="summary-row">
            <span>Rotation:</span> <span>${summary.rotation}°</span>
        </div>
    </div>`;
}

// Reset image settings (Retained from original code)
function resetImageSettings() {
    const settings = imageProcessor.resetSettings();
    
    // Update UI to match reset settings
    ditherMethodSelect.value = settings.ditherMethod;
    thresholdValueInput.value = settings.threshold;
    thresholdDisplay.textContent = settings.threshold;
    imageInvertInput.checked = settings.invert;
    imageWidthInput.value = settings.width;
    autoscaleImageInput.checked = settings.autoscale;
    imagePaddingInput.value = settings.padding;
    
    // Update preview
    updateImagePreview();
    logger.info('Image settings reset to defaults');
}

// Print the processed image (Retained from original code)
async function printProcessedImage() {
    const canvas = imageProcessor.processImage();
    
    if (!canvas) {
        logger.warn('No image to print');
        showPrintingStatus('No image to print', 'error');
        setTimeout(() => hidePrintingStatus(), 3000);
        return;
    }
    
    try {
        // Check if printer is connected
        if (!isPrinterConnected()) {
            logger.warn('Printer not connected');
            showPrintingStatus('Please connect to printer first', 'error');
            setTimeout(() => hidePrintingStatus(), 3000);
            return;
        }
        
        // Show printing status
        showPrintingStatus('Printing image...');
        
        // Log print job starting
        logger.info('Starting new print job');
        
        // Print the image
        await printImage(canvas);
        
        // Show success message
        showPrintingStatus('Image printed successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Print error:', err);
        logger.error('Print error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}

// === Connection and Battery Status (Retained from original code) ===
function setupConnectButtons() {
    // Add event listeners to both connect buttons
    connectReceiptBtn.addEventListener('click', handleConnectPrinter);
    connectImageBtn.addEventListener('click', handleConnectPrinter);
}

function updatePrintButtonState() {
    const connected = isPrinterConnected();
    
    // Update print buttons
    printReceiptBtn.disabled = !connected;
    printImageBtn.disabled = !connected;
    
    if (connected) {
        printReceiptBtn.classList.remove('btn-secondary');
        printReceiptBtn.classList.add('btn-primary');
        printImageBtn.classList.remove('btn-secondary');
        printImageBtn.classList.add('btn-primary');
    } else {
        printReceiptBtn.classList.remove('btn-primary');
        printReceiptBtn.classList.add('btn-secondary');
        printImageBtn.classList.remove('btn-primary');
        printImageBtn.classList.add('btn-secondary');
    }
    
    // Update connect buttons
    const buttonText = connected ? 'Reconnect' : 'Connect Printer';
    connectReceiptBtn.textContent = buttonText;
    connectImageBtn.textContent = buttonText;
    
    // Start or stop battery check based on connection status
    if (connected && !batteryCheckIntervalId) {
        startBatteryCheck();
    } else if (!connected && batteryCheckIntervalId) {
        stopBatteryCheck();
    }
}

async function handleConnectPrinter() {
    try {
        showPrintingStatus('Connecting to printer...');
        logger.info('Connecting to printer');
        await connectPrinter();
        
        // Update battery immediately after connection
        await updateBatteryStatus();
        
        // Start periodic battery check
        startBatteryCheck();
        
        // Update print button state
        updatePrintButtonState();
        
        showPrintingStatus('Printer connected successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Connection error:', err);
        logger.error('Connection error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}

function startBatteryCheck() {
    if (batteryCheckIntervalId) {
        clearInterval(batteryCheckIntervalId);
    }
    
    batteryCheckIntervalId = setInterval(async () => {
        if (isPrinterConnected()) {
            try {
                await updateBatteryStatus();
            } catch (error) {
                logger.warn('Failed to update battery status', { error: error.message });
            }
        } else {
            stopBatteryCheck();
        }
    }, BATTERY_CHECK_INTERVAL);
    
    logger.debug('Battery check interval started', { intervalMs: BATTERY_CHECK_INTERVAL });
}

function stopBatteryCheck() {
    if (batteryCheckIntervalId) {
        clearInterval(batteryCheckIntervalId);
        batteryCheckIntervalId = null;
        logger.debug('Battery check interval stopped');
    }
}

async function updateBatteryStatus() {
    try {
        let level;
        
        if (isPrinterConnected()) {
            // If connected, try to get fresh battery level
            level = await getBatteryLevel();
        } else {
            // If not connected, use last known level
            level = getLastKnownBatteryLevel();
        }
        
        if (level !== null) {
            updateBatteryIndicator(level);
        }
    } catch (error) {
        logger.warn('Error getting battery level', { message: error.message });
    }
}

function updateBatteryIndicator(level) {
    // Update the UI to display battery level
    if (level === null) {
        batteryIndicator.style.display = 'none';
        return;
    }
    
    batteryIndicator.style.display = 'flex';
    
    // Show percentage
    batteryLevel.textContent = `${level}%`;
    
    // Set color based on level
    if (level < 20) {
        batteryLevel.className = 'battery-level low';
        batteryIcon.innerHTML = '🔋';
    } else if (level < 50) {
        batteryLevel.className = 'battery-level medium';
        batteryIcon.innerHTML = '🔋';
    } else {
        batteryLevel.className = 'battery-level high';
        batteryIcon.innerHTML = '🔋';
    }
    
    logger.debug('Battery indicator updated', { level });
}

// === UI Feedback (Retained from original code) ===
function showPrintingStatus(message, type = 'info') {
    // Create status bar if it doesn't exist
    let statusBar = document.querySelector('.printing-status');
    
    if (!statusBar) {
        statusBar = document.createElement('div');
        statusBar.className = 'printing-status';
        document.body.appendChild(statusBar);
    }
    
    // Set color based on current mode and status type
    if (type === 'info') {
        statusBar.style.backgroundColor = currentMode === 'receipt' ? '#3182ce' : '#c53030';
    } else if (type === 'success') {
        statusBar.style.backgroundColor = '#2f855a';
    } else if (type === 'error') {
        statusBar.style.backgroundColor = '#c53030';
    }
    
    statusBar.textContent = message;
    statusBar.className = `printing-status ${type} active`;
}

function hidePrintingStatus() {
    const statusBar = document.querySelector('.printing-status');
    if (statusBar) {
        statusBar.classList.remove('active');
    }
}

// === Event Listeners ===
// The old receipt listeners are removed.
printReceiptBtn.addEventListener('click', handlePrintText);

// Initialize the app
init();