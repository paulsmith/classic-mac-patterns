function assert(condition, message) {
  if (!condition) throw message || "Assertion failed";
}

class MacPatternShowcase {
  constructor() {
    this.patterns = [];
    this.currentPattern = null;
    this.patternsGrid = document.getElementById("patternsGrid");
    this.patternTmpl = document.getElementById("patternTmpl");
    this.downloadRowTmpl = document.getElementById("downloadRowTmpl");
    this.downloadLinkTmpl = document.getElementById("downloadLinkTmpl");
    this.loadingIndicator = document.getElementById("loadingIndicator");
    this.desktop = document.getElementById("desktop");
    this.ctx = this.desktop.getContext("2d");
    this.patternInfo = document.getElementById("patternInfo");
    this.themeToggle = document.querySelector("theme-toggle");

    this.init();
  }

  async init() {
    await this.loadPatterns();
    this.createPatternGrid();
    this.setupEventListeners();
    this.setupTooltip();
    this.setupCopyButton();
    this.setupModal();
    this.initializeWithRandomPattern();
    this.createDownloadLinks();
  }

  async loadPatterns() {
    // Load sprite sheet .pbm with all 38 patterns in a single column
    try {
      const pbmData = await this.fetchPbmData();
      this.patterns = this.parsePbmToBinary(pbmData);
    } catch (error) {
      console.error(`Loading pattern sprite sheet:`, error);
      throw error;
    }
  }

  async fetchPbmData() {
    const response = await fetch(`patterns.pbm`);
    return await response.text();
  }

  parsePbmToBinary(pbmData) {
    const patterns = [];

    // Parse NetPBM P1 format (plain ASCII bitmap)
    let lines = pbmData.trim().split("\n");
    if (lines[0] !== "P1" || !lines[1].match(/^\d+\s+\d+$/)) {
      throw new Error("Invalid NetPBM P1 format");
    }
    const [cols, rows] = [...lines[1].matchAll(/(\d+)/g)].map((n) =>
      parseInt(n),
    );
    assert(cols === 8, "expected 8 columns");
    assert(rows % 8 === 0, "expected a whole number of 8-row patterns");
    lines = lines.slice(2);
    const patternCount = rows / 8;

    for (let pattern = 0; pattern < patternCount; pattern++) {
      const binaryPattern = [];

      // Parse 8 rows of pattern data
      for (let row = 0; row < 8; row++) {
        const rowData = [];
        const bits = lines[pattern * 8 + row].trim().split(/\s+/);
        for (let col = 0; col < 8; col++) {
          // In PBM: 0=white, 1=black (same as our binary representation)
          rowData.push(parseInt(bits[col] || "0", 10));
        }
        binaryPattern.push(rowData);
      }

      patterns.push({
        id: pattern,
        number: new String(pattern),
        binaryPattern: binaryPattern,
      });
    }

    return patterns;
  }

  patternTo64Bit(pattern) {
    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        bits += pattern.binaryPattern[y][x].toString();
      }
    }
    return BigInt("0b" + bits);
  }

  createBackgroundPattern(pattern) {
    const canvasSize = 8;
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext("2d");

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bit = pattern.binaryPattern[y][x];
        ctx.fillStyle = bit ? "#000000" : "#ffffff";
        ctx.fillRect(x, y, 1, 1);
      }
    }

    return canvas.toDataURL();
  }

  getResolvedCssVar(varName) {
    const helper = document.createElement("div");
    helper.style.setProperty("display", "none");
    helper.style.setProperty("color", `var(${varName})`);
    document.body.appendChild(helper);
    const resolvedColor = getComputedStyle(helper).color;
    document.body.removeChild(helper);
    return resolvedColor;
  }

  createPageBackgroundPattern(pattern) {
    // Create a "fat bits" background pattern - scale 8x8 for chunky pixelation
    const scale = 4;
    const canvasSize = 8 * scale; // 32px
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext("2d");

    const darkColor = this.getResolvedCssVar("--pattern-bg-dark");
    const lightColor = this.getResolvedCssVar("--pattern-bg-light");

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bit = pattern.binaryPattern[y][x];
        ctx.fillStyle = bit ? darkColor : lightColor;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    return { dataUrl: canvas.toDataURL(), size: canvasSize };
  }

  renderPatternToDisplay(pattern) {
    // Create the pattern on an 8x8 off-screen canvas
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

    // Use the canvas pattern to fill the main display
    const canvasPattern = this.ctx.createPattern(patternCanvas, "repeat");
    this.ctx.fillStyle = canvasPattern;
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
  }

  createPatternGrid() {
    // Hide loading indicator and show patterns grid
    this.loadingIndicator.style.display = "none";
    this.patternsGrid.style.display = "flex";

    this.patterns.forEach((pattern) => {
      const clone = document.importNode(this.patternTmpl.content, true);
      const patternElement = clone.firstElementChild;
      patternElement.dataset.patternid = pattern.id;

      // Create visual pattern preview directly from binary data
      const canvas = clone.querySelector("canvas");
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

      // Add hover and click handlers
      patternElement.addEventListener("mouseenter", () => {
        this.previewPattern(pattern);
      });

      patternElement.addEventListener("mouseleave", () => {
        if (this.currentPattern) {
          // Return to the selected pattern
          this.renderPatternToDisplay(this.currentPattern);
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

    const standardGray = this.createBackgroundPattern(this.patterns[3]);
    this.patternsGrid.style.backgroundImage = `url(${standardGray})`;
  }

  setupEventListeners() {
    this.themeToggle.dispatchEvent(
      new CustomEvent("theme-toggle:request", {
        detail: {
          callback: (theme) => {
            this.updatePageBackgroundForTheme();
          },
        },
      }),
    );

    this.themeToggle.addEventListener("theme-toggle:toggled", (event) => {
      const { newTheme } = event.detail;
      this.updatePageBackgroundForTheme();
    });
  }

  setupCopyButton() {
    const copyBtn = document.getElementById("copyPbmBtn");
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const text = copyBtn.getAttribute("data-copy");
      if (text) {
        this.copyToClipboard(text, copyBtn);
      }
    });
  }

  setupModal() {
    const screen = document.getElementById("screen");
    const wallpaperModal = document.getElementById("wallpaperModal");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalPatternTitle = document.getElementById("modalPatternTitle");

    // Open modal when screen is clicked (anywhere on the display area)
    const openModal = (e) => {
      e.preventDefault();
      if (this.currentPattern) {
        const displayNumber = parseInt(
          this.currentPattern.number,
          10,
        ).toString();
        modalPatternTitle.textContent = `Pattern ${displayNumber} - Download Wallpapers`;
        this.renderPatternsToModal(this.currentPattern);
        this.updateWallpaperLinks(this.currentPattern);
        wallpaperModal.showModal();
      }
    };

    // Add click listener to entire screen area
    screen.addEventListener("click", openModal);

    // Close modal when close button is clicked
    modalCloseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      wallpaperModal.close();
    });

    // Close modal when clicking on backdrop
    wallpaperModal.addEventListener("click", (e) => {
      if (e.target === wallpaperModal) {
        wallpaperModal.close();
      }
    });

    // Close modal on Escape key (this is handled natively by dialog, but we can add custom logic if needed)
    wallpaperModal.addEventListener("close", () => {
      // Modal is closing - can add any cleanup logic here if needed
    });
  }

  renderPatternToCanvas(canvas, pattern, inverted = false) {
    const ctx = canvas.getContext("2d");

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale factor based on canvas size
    const scale = canvas.width / 8;

    // Draw the pattern scaled up
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let bit = pattern.binaryPattern[y][x];
        if (inverted) bit = 1 - bit; // Invert the bit
        ctx.fillStyle = bit ? "#000000" : "#ffffff";
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  renderPatternsToModal(pattern) {
    const regularCanvas = document.getElementById("modalPatternRegular");
    const invertedCanvas = document.getElementById("modalPatternInverted");

    this.renderPatternToCanvas(regularCanvas, pattern, false);
    this.renderPatternToCanvas(invertedCanvas, pattern, true);
  }

  setPageBackground(pattern) {
    const { dataUrl, size } = this.createPageBackgroundPattern(pattern);
    document.body.style.backgroundImage = `url(${dataUrl})`;
    document.body.style.backgroundRepeat = "repeat";
    document.body.style.backgroundSize = `${size}px ${size}px`;
  }

  updatePageBackgroundForTheme() {
    // Regenerate the current pattern background with new theme colors
    if (this.currentPattern) {
      this.setPageBackground(this.currentPattern);
    }
  }

  initializeWithRandomPattern() {
    if (this.patterns.length > 0) {
      let patnum = Math.floor(Math.random() * this.patterns.length);
      while (patnum === 0 || patnum === 19)
        // black or white
        patnum = Math.floor(Math.random() * this.patterns.length);
      const randomPattern = this.patterns[patnum];
      this.currentPattern = randomPattern;
      this.setPageBackground(randomPattern);
      this.renderPatternToDisplay(randomPattern);
    }
  }

  previewPattern(pattern) {
    this.renderPatternToDisplay(pattern);
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
    this.renderPatternToDisplay(pattern);
    this.updatePatternInfo(pattern, true);
    this.setPageBackground(pattern);
  }

  clearPreview() {
    if (!this.currentPattern) {
      // Clear canvas with white background
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
      this.updatePatternInfo(null, false);
    }
  }

  updatePatternInfo(pattern, isSelected) {
    const patternStatus = document.getElementById("patternStatus");
    const patternPreview = document.getElementById("patternPreview");
    const pbmContent = document.getElementById("pbmContent");
    const copyBtn = document.getElementById("copyPbmBtn");
    const numberDecimal = document.getElementById("numberDecimal");
    const numberHex = document.getElementById("numberHex");
    const displayIndicator = document.getElementById("displayIndicator");

    if (pattern) {
      const status = isSelected ? "Selected" : "Previewing";
      const displayNumber = parseInt(pattern.number, 10).toString();

      // Create PBM representation
      const pbmLines = pattern.binaryPattern
        .map((row) => row.join(" "))
        .join("\n");
      const pbm = "P1\n8 8\n" + pbmLines;

      const number64bit = this.patternTo64Bit(pattern);
      const decimal = number64bit.toString();
      const hex = "0x" + number64bit.toString(16).toUpperCase();

      // Update DOM elements
      patternStatus.innerHTML = `<strong>${status}: Pattern ${displayNumber}</strong>`;
      pbmContent.textContent = pbm;
      copyBtn.setAttribute("data-copy", pbm);
      if (numberDecimal) numberDecimal.textContent = decimal;
      if (numberHex) numberHex.textContent = hex;
      patternPreview.style.display = "block";

      // Show display indicator for selected patterns only
      if (isSelected) {
        this.currentPattern = pattern; // Store for modal use
        displayIndicator.style.display = "block";
        // Add subtle entrance animation
        displayIndicator.classList.add("pulse");
        setTimeout(() => displayIndicator.classList.remove("pulse"), 1000);
      } else {
        displayIndicator.style.display = "none";
        displayIndicator.classList.remove("pulse");
      }
    } else {
      // Clear pattern info
      patternStatus.textContent =
        "Click a pattern to preview on the 512×342 display";
      patternPreview.style.display = "none";
      displayIndicator.style.display = "none";
      displayIndicator.classList.remove("pulse");
    }
  }

  updateWallpaperLinks(pattern) {
    const wallpaperGrid = document.getElementById("wallpaperGrid");
    const patternNumber = String(pattern.id).padStart(2, "0");

    // Define resolutions with device names and available sizes
    const resolutions = [
      { width: 1290, height: 2796, deviceName: "iPhone 15 Pro Max" },
      { width: 2048, height: 2732, deviceName: "iPad Pro" },
      { width: 1920, height: 1080, deviceName: "Full HD" },
      { width: 2560, height: 1440, deviceName: "2K/QHD" },
      { width: 3840, height: 2160, deviceName: "4K/UHD" },
    ];

    const pixelSizes = [16, 32, 64];

    // Clear existing content
    wallpaperGrid.innerHTML = "";

    resolutions.forEach((resolution) => {
      const resolutionDiv = document.createElement("div");
      resolutionDiv.className = "wallpaper-resolution";

      const header = document.createElement("h4");
      header.innerHTML = `${resolution.deviceName}<br><span class="resolution-text">${resolution.width}×${resolution.height}</span>`;
      resolutionDiv.appendChild(header);

      const linksDiv = document.createElement("div");
      linksDiv.className = "wallpaper-links";

      pixelSizes.forEach((pixelSize) => {
        const regularFile = `pattern_${patternNumber}_${resolution.width}x${resolution.height}_${pixelSize}px.png`;
        const invertedFile = `pattern_${patternNumber}_${resolution.width}x${resolution.height}_${pixelSize}px_inverted.png`;

        // Check if files exist by trying to create links (we'll style them appropriately)
        const linkContainer = document.createElement("div");
        linkContainer.className = "wallpaper-link-container";

        const sizeLabel = document.createElement("span");
        sizeLabel.className = "wallpaper-size-label";
        sizeLabel.textContent = `${pixelSize}px`;
        linkContainer.appendChild(sizeLabel);

        const regularLink = document.createElement("a");
        regularLink.href = `wallpapers/${regularFile}`;
        regularLink.target = "_blank";
        regularLink.className = "wallpaper-link regular";
        regularLink.textContent = "Regular";
        regularLink.download = regularFile;
        linkContainer.appendChild(regularLink);

        const invertedLink = document.createElement("a");
        invertedLink.href = `wallpapers/${invertedFile}`;
        invertedLink.target = "_blank";
        invertedLink.className = "wallpaper-link inverted";
        invertedLink.textContent = "Inverted";
        invertedLink.download = invertedFile;
        linkContainer.appendChild(invertedLink);

        linksDiv.appendChild(linkContainer);
      });

      resolutionDiv.appendChild(linksDiv);
      wallpaperGrid.appendChild(resolutionDiv);
    });
  }

  setupTooltip() {
    const trigger = document.querySelector(".pbm-label");
    const tooltip = document.getElementById("pbmTooltip");

    if (!trigger || !tooltip) return;

    let showTimeout;
    let hideTimeout;

    const showTooltip = () => {
      clearTimeout(hideTimeout);
      showTimeout = setTimeout(() => {
        tooltip.setAttribute("aria-hidden", "false");
        tooltip.classList.add("visible");
        this.positionTooltip(trigger, tooltip);
      }, 500); // 500ms delay for show
    };

    const hideTooltip = () => {
      clearTimeout(showTimeout);
      hideTimeout = setTimeout(() => {
        tooltip.setAttribute("aria-hidden", "true");
        tooltip.classList.remove("visible");
      }, 300); // 300ms delay for hide
    };

    const immediateHide = () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      tooltip.setAttribute("aria-hidden", "true");
      tooltip.classList.remove("visible");
    };

    // Mouse events
    trigger.addEventListener("mouseenter", showTooltip);
    trigger.addEventListener("mouseleave", hideTooltip);

    // Allow hovering over tooltip content
    tooltip.addEventListener("mouseenter", () => clearTimeout(hideTimeout));
    tooltip.addEventListener("mouseleave", hideTooltip);

    // Keyboard events
    trigger.addEventListener("focus", showTooltip);
    trigger.addEventListener("blur", hideTooltip);

    // Escape key to close
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        tooltip.getAttribute("aria-hidden") === "false"
      ) {
        immediateHide();
        trigger.focus();
      }
    });
  }

  positionTooltip(trigger, tooltip) {
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Reset positioning
    tooltip.style.left = "";
    tooltip.style.right = "";
    tooltip.style.top = "";
    tooltip.style.bottom = "";

    // Calculate preferred position (above and centered)
    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    let top = triggerRect.top - tooltipRect.height - 8;

    // Adjust if tooltip goes off screen horizontally
    if (left < 8) {
      left = 8;
    } else if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }

    // Adjust if tooltip goes off screen vertically (position below instead)
    if (top < 8) {
      top = triggerRect.bottom + 8;
      tooltip.classList.add("below");
    } else {
      tooltip.classList.remove("below");
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  copyToClipboard(text, button) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = "✓";
        button.style.color = "#999999";
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
        button.style.color = "#4CAF50";
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = "";
        }, 1000);
      });
  }

  createDownloadLinks() {
    const resolutions = ["8x8", "16x16", "32x32", "64x64"];
    const formats = ["PBM", "PNG", "GIF", "WebP", "AVIF", "TIFF", "ICO"];
    formats.forEach((format) => {
      const row = document.importNode(this.downloadRowTmpl.content, true);
      row.querySelector(".format-header").textContent = format;
      resolutions.forEach((res) => {
        if (format === "PBM" && res !== "8x8") return;
        const link = document.importNode(this.downloadLinkTmpl.content, true);
        const url = `assets/archives/${format.toLowerCase()}_${res}.zip`;
        link.firstElementChild.href = url;
        link.firstElementChild.textContent = res;
        row.querySelector(".resolutions").appendChild(link);
      });
      document.querySelector(".download-grid").appendChild(row);
    });
  }
}

// Initialize the showcase when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new MacPatternShowcase();
});
