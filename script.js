// Global variables for processing
let processingActive = false;
let processingCancelled = false;
let currentFileContent = null;
let processedResults = {
    valid: [],           // Array of valid numbers
    invalid: [],         // Array of invalid numbers
    byState: {},         // Numbers grouped by state
    stats: {
        total: 0,
        valid: 0,
        invalid: 0,
        states: new Set()
    }
};

// Performance monitoring
let startTime = 0;
let processedCount = 0;
let lastUpdateTime = 0;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    setupDragAndDrop();
    setupFileInput();
    initializeChart();
});

// Setup drag and drop
function setupDragAndDrop() {
    const uploadArea = document.getElementById('uploadArea');
    
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', function() {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
}

// Setup file input
function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleFile(this.files[0]);
        }
    });
}

// Handle file selection
function handleFile(file) {
    if (!file.name.endsWith('.txt')) {
        alert('Please select a .txt file');
        return;
    }
    
    // Show file info
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    
    // Estimate processing time
    const estimatedLines = Math.floor(file.size / 15); // Approximate lines
    const estimatedTime = estimateProcessingTime(estimatedLines);
    document.getElementById('estimatedTime').textContent = 
        `Estimated: ${estimatedLines.toLocaleString()} numbers (~${estimatedTime})`;
    
    document.getElementById('fileInfo').classList.remove('d-none');
    document.getElementById('processBtn').disabled = false;
    
    // Read file
    const reader = new FileReader();
    reader.onload = function(e) {
        currentFileContent = e.target.result;
    };
    reader.readAsText(file);
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Estimate processing time
function estimateProcessingTime(numLines) {
    const linesPerSecond = 50000; // Conservative estimate
    const seconds = Math.ceil(numLines / linesPerSecond);
    
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

// Start processing
function startProcessing() {
    if (!currentFileContent || processingActive) return;
    
    // Reset state
    processingActive = true;
    processingCancelled = false;
    resetProcessingState();
    
    // Show progress section
    document.getElementById('progressSection').classList.remove('d-none');
    document.getElementById('processBtn').classList.add('d-none');
    document.getElementById('cancelBtn').classList.remove('d-none');
    document.getElementById('resultsSection').classList.add('d-none');
    
    // Get processing options
    const options = {
        removePlusOne: document.getElementById('removePlusOne').checked,
        filterInvalid: document.getElementById('filterInvalid').checked,
        groupByState: document.getElementById('groupByState').checked,
        batchSize: parseInt(document.getElementById('batchSize').value)
    };
    
    // Split content into lines
    const lines = currentFileContent.split('\n');
    processedResults.stats.total = lines.length;
    
    // Start timing
    startTime = performance.now();
    lastUpdateTime = startTime;
    
    // Process in batches (Web Worker style)
    processInBatches(lines, options);
}

// Process in batches for performance
async function processInBatches(lines, options) {
    const batchSize = options.batchSize;
    const totalBatches = Math.ceil(lines.length / batchSize);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        if (processingCancelled) break;
        
        const startIdx = batchIndex * batchSize;
        const endIdx = Math.min(startIdx + batchSize, lines.length);
        const batch = lines.slice(startIdx, endIdx);
        
        // Process batch
        await processBatch(batch, options);
        
        // Update progress
        const progress = ((batchIndex + 1) / totalBatches) * 100;
        updateProgressUI(progress, processedCount);
        
        // Yield to UI thread
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    finishProcessing();
}

// Process a single batch
async function processBatch(batch, options) {
    for (let i = 0; i < batch.length; i++) {
        if (processingCancelled) return;
        
        const line = batch[i].trim();
        if (!line) continue;
        
        processSingleNumber(line, options);
        processedCount++;
        
        // Update speed every 1000 numbers
        if (processedCount % 1000 === 0) {
            updateProcessingSpeed();
        }
    }
}

// Process single phone number
function processSingleNumber(rawNumber, options) {
    // Clean the number
    let cleaned = cleanPhoneNumber(rawNumber, options.removePlusOne);
    
    // Validate
    if (isValidUSNumber(cleaned)) {
        const areaCode = cleaned.substring(0, 3);
        const state = getStateFromAreaCode(areaCode);
        
        const result = {
            original: rawNumber,
            cleaned: cleaned, // This will be 10-digit format: 6125544556
            areaCode: areaCode,
            state: state,
            status: 'valid'
        };
        
        processedResults.valid.push(result);
        processedResults.stats.valid++;
        processedResults.stats.states.add(state);
        
        // Group by state
        if (options.groupByState) {
            if (!processedResults.byState[state]) {
                processedResults.byState[state] = [];
            }
            processedResults.byState[state].push(result);
        }
    } else {
        processedResults.invalid.push({
            original: rawNumber,
            cleaned: cleaned,
            status: 'invalid'
        });
        processedResults.stats.invalid++;
    }
}

// Clean phone number to 10-digit format
function cleanPhoneNumber(number, removePlusOne) {
    // Remove all non-digit characters
    let cleaned = number.replace(/\D/g, '');
    
    // Remove US country code if present
    if (removePlusOne && cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = cleaned.substring(1);
    }
    
    // If still longer than 10 digits, take last 10
    if (cleaned.length > 10) {
        cleaned = cleaned.substring(cleaned.length - 10);
    }
    
    return cleaned;
}

// Validate US phone number
function isValidUSNumber(number) {
    // Must be exactly 10 digits
    if (number.length !== 10) return false;
    
    // First digit cannot be 0 or 1
    if (number[0] === '0' || number[0] === '1') return false;
    
    // Area code validation
    const areaCode = number.substring(0, 3);
    if (!isValidAreaCode(areaCode)) return false;
    
    // Exchange code validation (NXX)
    const exchangeCode = number.substring(3, 6);
    if (exchangeCode[0] === '0' || exchangeCode[0] === '1') return false;
    
    // Invalid patterns
    const invalidPatterns = [
        /^(\d)\1{9}$/, // All same digits
        /^1234567890$/, // Sequential
        /^(\d{3})\1{2}$/ // Repeated pattern
    ];
    
    for (const pattern of invalidPatterns) {
        if (pattern.test(number)) return false;
    }
    
    return true;
}

// Update UI during processing
function updateProgressUI(progress, processed) {
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = `${progress}%`;
    progressBar.textContent = `${Math.round(progress)}%`;
    
    document.getElementById('processedCount').textContent = processed.toLocaleString();
    document.getElementById('validCount').textContent = processedResults.stats.valid.toLocaleString();
    
    // Update status text
    const elapsed = (performance.now() - startTime) / 1000;
    const remaining = (processedResults.stats.total - processed) / (processed / elapsed);
    document.getElementById('progressStatus').textContent = 
        `Processing... ${Math.round(remaining)} seconds remaining`;
}

// Update processing speed
function updateProcessingSpeed() {
    const now = performance.now();
    const elapsed = (now - lastUpdateTime) / 1000;
    const speed = Math.round(1000 / elapsed);
    document.getElementById('processingSpeed').textContent = `${speed.toLocaleString()}/sec`;
    lastUpdateTime = now;
}

// Finish processing
function finishProcessing() {
    processingActive = false;
    
    // Hide progress section
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('cancelBtn').classList.add('d-none');
    document.getElementById('processBtn').classList.remove('d-none');
    
    // Update final counts
    document.getElementById('totalCount').textContent = processedResults.stats.total.toLocaleString();
    document.getElementById('finalValidCount').textContent = processedResults.stats.valid.toLocaleString();
    document.getElementById('finalInvalidCount').textContent = processedResults.stats.invalid.toLocaleString();
    document.getElementById('finalStatesCount').textContent = processedResults.stats.states.size;
    
    // Create state buttons
    createStateButtons();
    
    // Update chart
    updateChart();
    
    // Populate preview table
    populatePreviewTable();
    
    // Show results
    document.getElementById('resultsSection').classList.remove('d-none');
    
    // Scroll to results
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    
    // Show completion message
    const elapsed = (performance.now() - startTime) / 1000;
    alert(`Processing complete!\n\n` +
          `Processed: ${processedResults.stats.total.toLocaleString()} numbers\n` +
          `Valid: ${processedResults.stats.valid.toLocaleString()} numbers\n` +
          `Time: ${elapsed.toFixed(2)} seconds\n` +
          `Speed: ${Math.round(processedResults.stats.total / elapsed).toLocaleString()} numbers/sec`);
}

// Cancel processing
function cancelProcessing() {
    processingCancelled = true;
    processingActive = false;
    
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('cancelBtn').classList.add('d-none');
    document.getElementById('processBtn').classList.remove('d-none');
    
    alert('Processing cancelled.');
}

// Reset processing state
function resetProcessingState() {
    processedResults = {
        valid: [],
        invalid: [],
        byState: {},
        stats: {
            total: 0,
            valid: 0,
            invalid: 0,
            states: new Set()
        }
    };
    processedCount = 0;
}

// Create state download buttons
function createStateButtons() {
    const container = document.getElementById('stateButtons');
    container.innerHTML = '';
    
    const states = Object.keys(processedResults.byState).sort();
    
    states.forEach(state => {
        const count = processedResults.byState[state].length;
        const button = document.createElement('button');
        button.className = 'btn btn-outline-info btn-sm';
        button.innerHTML = `<i class="fas fa-download me-1"></i>${state} (${count})`;
        button.onclick = () => downloadStateNumbers(state);
        container.appendChild(button);
    });
}

// Download all valid numbers
function downloadAllValid() {
    const content = processedResults.valid.map(n => n.cleaned).join('\n');
    downloadFile('all-valid-numbers.txt', content);
}

// Download invalid numbers
function downloadInvalid() {
    const content = processedResults.invalid.map(n => `${n.original} => ${n.cleaned}`).join('\n');
    downloadFile('invalid-numbers.txt', content);
}

// Download state numbers
function downloadStateNumbers(state) {
    const numbers = processedResults.byState[state];
    const content = numbers.map(n => n.cleaned).join('\n');
    const filename = state.toLowerCase().replace(/\s+/g, '-') + '-numbers.txt';
    downloadFile(filename, content);
}

// Download all as ZIP
async function downloadAllAsZip() {
    const zip = new JSZip();
    const folder = zip.folder("phone-numbers-results");
    
    // All valid numbers
    const allValid = processedResults.valid.map(n => n.cleaned).join('\n');
    folder.file("all-valid-numbers.txt", allValid);
    
    // By state
    Object.entries(processedResults.byState).forEach(([state, numbers]) => {
        const content = numbers.map(n => n.cleaned).join('\n');
        folder.file(`${state}-numbers.txt`, content);
    });
    
    // Invalid numbers
    if (processedResults.invalid.length > 0) {
        const invalidContent = processedResults.invalid.map(n => `${n.original} => ${n.cleaned}`).join('\n');
        folder.file("invalid-numbers.txt", invalidContent);
    }
    
    // Summary report
    const summary = generateSummaryReport();
    folder.file("summary-report.txt", summary);
    
    // Generate and download
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "phone-numbers-results.zip");
}

// Generate summary report
function generateSummaryReport() {
    let report = "PHONE NUMBER PROCESSING REPORT\n";
    report += "===============================\n";
    report += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    report += `Total Numbers Processed: ${processedResults.stats.total}\n`;
    report += `Valid US Numbers: ${processedResults.stats.valid}\n`;
    report += `Invalid Numbers: ${processedResults.stats.invalid}\n`;
    report += `States Found: ${processedResults.stats.states.size}\n\n`;
    
    report += "DISTRIBUTION BY STATE:\n";
    report += "=====================\n";
    
    // Sort states by count
    const states = Object.entries(processedResults.byState)
        .sort((a, b) => b[1].length - a[1].length);
    
    states.forEach(([state, numbers]) => {
        const percentage = (numbers.length / processedResults.stats.valid * 100).toFixed(1);
        report += `${state.padEnd(20)}: ${numbers.length.toString().padStart(8)} (${percentage}%)\n`;
    });
    
    return report;
}

// Download helper
function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Populate preview table
function populatePreviewTable() {
    const table = document.getElementById('previewTable');
    table.innerHTML = '';
    
    // Show first 100 valid numbers
    const previewData = processedResults.valid.slice(0, 100);
    
    previewData.forEach((num, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><small>${num.original}</small></td>
            <td><strong>${num.cleaned}</strong></td>
            <td><span class="badge bg-info">${num.areaCode}</span></td>
            <td><span class="badge bg-primary">${num.state}</span></td>
            <td><span class="badge bg-success">Valid</span></td>
        `;
        table.appendChild(row);
    });
    
    // Add message if more numbers exist
    if (processedResults.valid.length > 100) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="6" class="text-center text-muted">
                ... and ${processedResults.valid.length - 100} more valid numbers
            </td>
        `;
        table.appendChild(row);
    }
}

// Chart.js initialization
let numbersChart = null;

function initializeChart() {
    const ctx = document.getElementById('statesChart').getContext('2d');
    numbersChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Phone Numbers',
                data: [],
                backgroundColor: 'rgba(54, 162, 235, 0.7)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 15
                    }
                }
            }
        }
    });
}

// Update chart with data
function updateChart() {
    if (!numbersChart) return;
    
    const states = Object.entries(processedResults.byState)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 20); // Show top 20 states
    
    numbersChart.data.labels = states.map(([state]) => state);
    numbersChart.data.datasets[0].data = states.map(([, numbers]) => numbers.length);
    numbersChart.update();
}
