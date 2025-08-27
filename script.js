// ABOUTME: JavaScript for interactive Macintosh desktop pattern showcase
// ABOUTME: Handles pattern loading, tiling display, and user interactions with Mac Plus virtual screen

class MacPatternShowcase {
  constructor() {
    this.patterns = [];
    this.currentPattern = null;
    this.patternsGrid = document.getElementById("patternsGrid");
    this.desktop = document.getElementById("desktop");
    this.ctx = this.desktop.getContext("2d");
    this.patternInfo = document.getElementById("patternInfo");
    this.resetButton = document.getElementById("resetButton");

    this.init();
  }

  async init() {
    await this.loadPatterns();
    this.createPatternGrid();
    this.setupEventListeners();
  }

  async loadPatterns() {
    // Load all 38 patterns (000-037)
    for (let i = 0; i < 38; i++) {
      const patternNum = i.toString().padStart(3, "0");
      try {
        const pbmData = await this.fetchPbmData(patternNum);
        const binaryPattern = this.parsePbmToBinary(pbmData);
        this.patterns.push({
          id: i,
          number: patternNum,
          pbmData: pbmData,
          binaryPattern: binaryPattern,
        });
      } catch (error) {
        console.warn(`Failed to load pattern ${patternNum}:`, error);
      }
    }
  }

  async fetchPbmData(patternNum) {
    try {
      const response = await fetch(`patterns/pattern_${patternNum}.pbm`);
      return await response.text();
    } catch (error) {
      console.warn(`Could not load PBM data for pattern ${patternNum}`);
      return "PBM data unavailable";
    }
  }

  parsePbmToBinary(pbmData) {
    // Parse NetPBM P1 format (plain ASCII bitmap)
    const lines = pbmData.trim().split("\n");
    const binaryPattern = [];

    // Skip header lines (P1, comments starting with #, dimensions)
    let dataStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "P1" || line.startsWith("#")) {
        continue;
      }
      if (line.match(/^\d+\s+\d+$/)) {
        // Found dimensions line, data starts next
        dataStartIndex = i + 1;
        break;
      }
    }

    // Parse 8 rows of pattern data
    for (let row = 0; row < 8; row++) {
      const rowData = [];
      if (dataStartIndex + row < lines.length) {
        const bits = lines[dataStartIndex + row].trim().split(/\s+/);
        for (let col = 0; col < 8; col++) {
          // In PBM: 0=white, 1=black (same as our binary representation)
          rowData.push(parseInt(bits[col] || "0", 10));
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

  createPageBackgroundPattern(pattern) {
    // Create a "fat bits" background pattern - scale 8x8 to 32x32 for chunky pixelation
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = 8 * scale;
    canvas.height = 8 * scale;
    const ctx = canvas.getContext("2d");

    // Use muted grayscale colors for subtlety
    const darkColor = "#e8e8e8"; // Light gray instead of black
    const lightColor = "#f8f8f8"; // Very light gray instead of white

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bit = pattern.binaryPattern[y][x];
        ctx.fillStyle = bit ? darkColor : lightColor;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    return canvas.toDataURL();
  }

  renderPatternToCanvas(pattern) {
    // 1. Synchronize canvas resolution with its display size
    // This is the key fix to prevent browser scaling and anti-aliasing.
    if (
      this.desktop.width !== this.desktop.clientWidth ||
      this.desktop.height !== this.desktop.clientHeight
    ) {
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
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);

    if (!pattern || !pattern.binaryPattern) return;

    // 3. Create the pattern on an 8x8 off-screen canvas
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 8;
    patternCanvas.height = 8;
    const patternCtx = patternCanvas.getContext("2d");

    // Draw the 8x8 tile from binary data
    const imageData = patternCtx.createImageData(8, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const index = (y * 8 + x) * 4;
        const color = pattern.binaryPattern[y][x] === 1 ? 0 : 255; // Black or White
        imageData.data[index] = color; // R
        imageData.data[index + 1] = color; // G
        imageData.data[index + 2] = color; // B
        imageData.data[index + 3] = 255; // A
      }
    }
    patternCtx.putImageData(imageData, 0, 0);

    // 4. Use the canvas pattern to fill the main display
    const canvasPattern = this.ctx.createPattern(patternCanvas, "repeat");
    this.ctx.fillStyle = canvasPattern;
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
  }

  createPatternGrid() {
    this.patterns.forEach((pattern) => {
      const patternElement = document.createElement("div");
      patternElement.className = "pattern-item";
      patternElement.dataset.patternId = pattern.id;

      // Create visual pattern preview directly from binary data
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");

      const imageData = ctx.createImageData(8, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const index = (y * 8 + x) * 4;
          const color = pattern.binaryPattern[y][x] === 1 ? 0 : 255;
          imageData.data[index] = color; // R
          imageData.data[index + 1] = color; // G
          imageData.data[index + 2] = color; // B
          imageData.data[index + 3] = 255; // A
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Scale up the canvas for better visibility
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.imageRendering = "pixelated";

      patternElement.appendChild(canvas);

      // Add hover and click handlers
      patternElement.addEventListener("mouseenter", () => {
        this.previewPattern(pattern);
      });

      patternElement.addEventListener("mouseleave", () => {
        if (this.currentPattern) {
          // Return to the selected pattern
          this.renderPatternToCanvas(this.currentPattern);
          this.updatePatternInfo(this.currentPattern, true);
        } else {
          this.clearPreview();
        }
      });

      patternElement.addEventListener("click", () => {
        this.selectPattern(pattern, patternElement);
      });

      this.patternsGrid.appendChild(patternElement);
    });
  }

  setupEventListeners() {
    this.resetButton.addEventListener("click", () => {
      this.resetDisplay();
    });
  }

  previewPattern(pattern) {
    this.renderPatternToCanvas(pattern);
    this.updatePatternInfo(pattern, false);
  }

  selectPattern(pattern, element) {
    // Remove active class from all pattern items
    document.querySelectorAll(".pattern-item").forEach((item) => {
      item.classList.remove("active");
    });

    // Add active class to selected item
    element.classList.add("active");

    this.currentPattern = pattern;
    this.renderPatternToCanvas(pattern);
    this.updatePatternInfo(pattern, true);

    // Set the pattern as page background
    const backgroundDataUrl = this.createPageBackgroundPattern(pattern);
    document.body.style.backgroundImage = `url(${backgroundDataUrl})`;
    document.body.style.backgroundRepeat = "repeat";
    document.body.style.backgroundSize = "32px 32px";
  }

  clearPreview() {
    if (!this.currentPattern) {
      // Clear canvas with white background
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
      this.patternInfo.innerHTML =
        "<div>Click a pattern to preview on the Mac Plus display</div>";
    }
  }

  updatePatternInfo(pattern, isSelected) {
    const status = isSelected ? "Selected" : "Previewing";
    const displayNumber = parseInt(pattern.number, 10).toString();

    // Convert binary pattern to hex bytes
    const hexBytes = pattern.binaryPattern.map((row) => {
      let byte = 0;
      for (let i = 0; i < 8; i++) {
        byte |= row[i] << (7 - i);
      }
      return byte.toString(16).toUpperCase().padStart(2, "0");
    });
    const hexString = hexBytes.join(" ");

    // Create PBM representation
    const pbmLines = pattern.binaryPattern
      .map((row) => row.join(" "))
      .join("\n");
    const pbm = "P1\n8 8\n" + pbmLines;

    this.patternInfo.innerHTML = `
            <div><strong>${status}: Pattern ${displayNumber}</strong></div>
            <div class="pattern-preview">
                Hex: ${hexString}
                <button class="copy-btn" data-copy="${hexString}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
            </div>
            <div class="pattern-preview">
                PBM: <button class="copy-btn" data-copy="${pbm.replace(/"/g, "&quot;")}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
                <pre>${pbm}</pre>
            </div>
        `;

    // Add copy functionality to the buttons
    this.patternInfo.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const text = btn.getAttribute("data-copy");
        this.copyToClipboard(text, btn);
      });
    });
  }

  copyToClipboard(text, button) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = "✓";
        button.style.color = "green";
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = "";
        }, 1000);
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);

        const originalText = button.innerHTML;
        button.innerHTML = "✓";
        button.style.color = "green";
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = "";
        }, 1000);
      });
  }

  resetDisplay() {
    this.currentPattern = null;
    // Clear canvas with white background
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
    this.patternInfo.innerHTML =
      "<div>Click a pattern to preview on the Mac Plus display</div>";

    // Clear page background pattern
    document.body.style.backgroundImage = "";
    document.body.style.backgroundRepeat = "";
    document.body.style.backgroundSize = "";

    // Remove active class from all pattern items
    document.querySelectorAll(".pattern-item").forEach((item) => {
      item.classList.remove("active");
    });
  }
}

// Initialize the showcase when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new MacPatternShowcase();
});
