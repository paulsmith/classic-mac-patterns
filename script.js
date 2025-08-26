// ABOUTME: JavaScript for interactive Macintosh desktop pattern showcase
// ABOUTME: Handles pattern loading, tiling display, and user interactions with Mac Plus virtual screen

class MacPatternShowcase {
    constructor() {
        this.patterns = [];
        this.currentPattern = null;
        this.patternsGrid = document.getElementById('patternsGrid');
        this.desktop = document.getElementById('desktop');
        this.ctx = this.desktop.getContext('2d');
        this.patternInfo = document.getElementById('patternInfo');
        this.resetButton = document.getElementById('resetButton');
        
        this.init();
    }
    
    async init() {
        await this.loadPatterns();
        this.createPatternGrid();
        this.setupEventListeners();
    }
    
    async loadPatterns() {
        // Load all 38 patterns (00-37)
        for (let i = 0; i < 38; i++) {
            const patternNum = i.toString().padStart(2, '0');
            try {
                const hexData = await this.fetchHexData(patternNum);
                const binaryPattern = this.parseHexToBinary(hexData.trim());
                this.patterns.push({
                    id: i,
                    number: patternNum,
                    imagePath: `patsharp_out/PATsharp_0/pattern_${patternNum}.png`,
                    hexData: hexData.trim(),
                    binaryPattern: binaryPattern
                });
            } catch (error) {
                console.warn(`Failed to load pattern ${patternNum}:`, error);
            }
        }
    }
    
    async fetchHexData(patternNum) {
        try {
            const response = await fetch(`patsharp_out/PATsharp_0/pattern_${patternNum}.hex`);
            return await response.text();
        } catch (error) {
            console.warn(`Could not load hex data for pattern ${patternNum}`);
            return 'Hex data unavailable';
        }
    }
    
    parseHexToBinary(hexData) {
        // Parse hex data like "FF FF FF FF FF FF FF FF" into 8x8 binary array
        const hexBytes = hexData.split(' ').filter(byte => byte.length === 2);
        const binaryPattern = [];
        
        for (let row = 0; row < 8; row++) {
            const rowData = [];
            if (hexBytes[row]) {
                const byte = parseInt(hexBytes[row], 16);
                // Convert byte to 8 bits (MSB first)
                for (let col = 0; col < 8; col++) {
                    rowData.push((byte >> (7 - col)) & 1);
                }
            } else {
                // Fallback for missing data
                for (let col = 0; col < 8; col++) {
                    rowData.push(0);
                }
            }
            binaryPattern.push(rowData);
        }
        
        return binaryPattern;
    }
    
    renderPatternToCanvas(pattern) {
        // 1. Synchronize canvas resolution with its display size
        // This is the key fix to prevent browser scaling and anti-aliasing.
        if (this.desktop.width !== this.desktop.clientWidth ||
            this.desktop.height !== this.desktop.clientHeight) {
            this.desktop.width = this.desktop.clientWidth;
            this.desktop.height = this.desktop.clientHeight;
        }

        // 2. Disable canvas smoothing for pixel-perfect rendering
        // This must be done *after* any potential resize, as resizing resets the context.
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;

        // Clear canvas with white background
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);

        if (!pattern || !pattern.binaryPattern) return;

        // 3. Create the pattern on an 8x8 off-screen canvas
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = 8;
        patternCanvas.height = 8;
        const patternCtx = patternCanvas.getContext('2d');

        // Draw the 8x8 tile from binary data
        const imageData = patternCtx.createImageData(8, 8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const index = (y * 8 + x) * 4;
                const color = pattern.binaryPattern[y][x] === 1 ? 0 : 255; // Black or White
                imageData.data[index] = color;     // R
                imageData.data[index + 1] = color; // G
                imageData.data[index + 2] = color; // B
                imageData.data[index + 3] = 255;   // A
            }
        }
        patternCtx.putImageData(imageData, 0, 0);

        // 4. Use the canvas pattern to fill the main display
        const canvasPattern = this.ctx.createPattern(patternCanvas, 'repeat');
        this.ctx.fillStyle = canvasPattern;
        this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
    }
    
    createPatternGrid() {
        this.patterns.forEach(pattern => {
            const patternElement = document.createElement('div');
            patternElement.className = 'pattern-item';
            patternElement.dataset.patternId = pattern.id;
            
            const img = document.createElement('img');
            img.src = pattern.imagePath;
            img.alt = `Pattern ${pattern.number}`;
            img.onerror = () => {
                // Fallback if image fails to load
                patternElement.style.backgroundColor = '#ddd';
                patternElement.innerHTML = pattern.number;
            };
            
            patternElement.appendChild(img);
            
            // Add hover and click handlers
            patternElement.addEventListener('mouseenter', () => {
                this.previewPattern(pattern);
            });
            
            patternElement.addEventListener('mouseleave', () => {
                if (this.currentPattern) {
                    // Return to the selected pattern
                    this.renderPatternToCanvas(this.currentPattern);
                    this.updatePatternInfo(this.currentPattern, true);
                } else {
                    this.clearPreview();
                }
            });
            
            patternElement.addEventListener('click', () => {
                this.selectPattern(pattern, patternElement);
            });
            
            this.patternsGrid.appendChild(patternElement);
        });
    }
    
    setupEventListeners() {
        this.resetButton.addEventListener('click', () => {
            this.resetDisplay();
        });
    }
    
    previewPattern(pattern) {
        this.renderPatternToCanvas(pattern);
        this.updatePatternInfo(pattern, false);
    }
    
    selectPattern(pattern, element) {
        // Remove active class from all pattern items
        document.querySelectorAll('.pattern-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to selected item
        element.classList.add('active');
        
        this.currentPattern = pattern;
        this.renderPatternToCanvas(pattern);
        this.updatePatternInfo(pattern, true);
    }
    
    clearPreview() {
        if (!this.currentPattern) {
            // Clear canvas with white background
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
            this.patternInfo.innerHTML = '<div>Click a pattern to preview on the Mac Plus display</div>';
        }
    }
    
    updatePatternInfo(pattern, isSelected) {
        const status = isSelected ? 'Selected' : 'Previewing';
        this.patternInfo.innerHTML = `
            <div><strong>${status}: Pattern ${pattern.number}</strong></div>
            <div class="hex-data">Hex Data: ${pattern.hexData}</div>
        `;
    }
    
    resetDisplay() {
        this.currentPattern = null;
        // Clear canvas with white background
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
        this.patternInfo.innerHTML = '<div>Click a pattern to preview on the Mac Plus display</div>';
        
        // Remove active class from all pattern items
        document.querySelectorAll('.pattern-item').forEach(item => {
            item.classList.remove('active');
        });
    }
}

// Initialize the showcase when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MacPatternShowcase();
});