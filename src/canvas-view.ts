import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownView, Modal, App } from "obsidian";

class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const btnRow = contentEl.createDiv({ cls: "modal-button-container" });
    btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const confirm = btnRow.createEl("button", { text: "Clear", cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
import { applyStrikethroughs } from "./text-utils";
import { OCRKeys } from "./ocr-engine";
import { StrokeEngine } from "./stroke-engine";
import { OCREngine } from "./ocr-engine";
import { DraftStore } from "./draft-store";
import { DrawingTool, OCRProvider, PencilPluginSettings } from "./types";
import { mergeCanvasBody, NoteCanvasParts, splitNoteForCanvas } from "./note-content";

export const PENCIL_VIEW_TYPE = "apple-pencil-canvas";

export class PencilCanvasView extends ItemView {
  private noteFile!: TFile; // set before any methods run; null-file guard is in onOpen
  private settings: PencilPluginSettings;
  private engine: StrokeEngine | null = null;
  private ocrEngine: OCREngine;
  private draftStore: DraftStore;
  private canvas: HTMLCanvasElement | null = null;
  private toolbar: HTMLElement | null = null;
  private isConverting = false;
  private isDirty = false;
  private isEditMode = false; // true when existing note content was loaded onto canvas
  private noteParts: NoteCanvasParts = { protectedPrefix: "", editableBody: "" };
  private ocrStatusEl: HTMLElement | null = null;
  private activeOCRProvider: OCRProvider;

  constructor(
    leaf: WorkspaceLeaf,
    noteFile: TFile | null, // null only when Obsidian restores a stale view on startup
    settings: PencilPluginSettings,
    ocrEngine: OCREngine,
    draftStore: DraftStore
  ) {
    super(leaf);
    if (noteFile) this.noteFile = noteFile;
    this.settings = settings;
    this.ocrEngine = ocrEngine;
    this.draftStore = draftStore;
    this.activeOCRProvider = settings.ocrProvider;
  }

  getViewType(): string {
    return PENCIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.noteFile ? `✏️ ${this.noteFile.basename}` : "✏️ Canvas";
  }

  getIcon(): string {
    return "pencil";
  }

  async onOpen() {
    if (!this.noteFile) return; // detaching — don't render anything

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("pencil-canvas-container");

    this.buildToolbar(container);
    this.buildCanvas(container);
    await this.loadExistingContent();
    await this.loadDraft();
    this.syncOCRProvider();

    // Refresh note content every time this canvas becomes the active leaf
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf === this.leaf) {
          this.syncOCRProvider();
          await this.loadExistingContent();
        }
      })
    );

    // Handle resize
    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(container);
    this.register(() => resizeObserver.disconnect());
  }

  private buildToolbar(container: HTMLElement) {
    this.toolbar = container.createDiv({ cls: "pencil-toolbar" });

    // Tool buttons
    const tools: { tool: DrawingTool; label: string }[] = [
      { tool: "pen", label: "Pen" },
      { tool: "eraser", label: "Erase" },
    ];

    const toolGroup = this.toolbar.createDiv({ cls: "pencil-tool-group" });
    for (const { tool, label } of tools) {
      const btn = toolGroup.createEl("button", { cls: "pencil-tool-btn", attr: { title: label } });
      btn.createEl("span", { cls: "pencil-tool-label", text: label });
      if (tool === "pen") btn.addClass("active");
      btn.addEventListener("click", () => {
        toolGroup.querySelectorAll(".pencil-tool-btn").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        this.engine?.setTool(tool);
      });
    }

    // Color picker — default to theme-aware color
    const isDarkMode = document.body.classList.contains("theme-dark");
    const initialColor = this.settings.defaultPenColor === "#000000" && isDarkMode
      ? "#ffffff"
      : this.settings.defaultPenColor;
    const colorInput = this.toolbar.createEl("input", {
      type: "color",
      cls: "pencil-color-picker",
      attr: { value: initialColor, title: "Pen color" },
    });
    colorInput.addEventListener("input", () => {
      this.engine?.setColor(colorInput.value);
    });

    // Width slider
    const widthSlider = this.toolbar.createEl("input", {
      cls: "pencil-width-slider",
      attr: { type: "range", min: "1", max: "10", value: String(this.settings.defaultPenWidth), title: "Stroke width" },
    });
    widthSlider.addEventListener("input", () => {
      this.engine?.setWidth(Number(widthSlider.value));
    });

    this.ocrStatusEl = this.toolbar.createEl("div", {
      cls: "pencil-ocr-status",
      attr: { title: "Current handwriting recognition provider" },
    });
    this.updateOCRStatus();

    // Spacer
    this.toolbar.createDiv({ cls: "pencil-toolbar-spacer" });

    // Undo
    const undoBtn = this.toolbar.createEl("button", { cls: "pencil-action-btn", text: "Undo", attr: { title: "Undo last stroke" } });
    undoBtn.addEventListener("click", () => this.engine?.undo());

    // Clear
    const clearBtn = this.toolbar.createEl("button", { cls: "pencil-action-btn pencil-danger-btn", text: "Clear", attr: { title: "Clear canvas" } });
    clearBtn.addEventListener("click", () => {
      new ConfirmModal(this.app, "Clear all ink strokes?", () => {
        if (this.isEditMode) {
          this.engine?.clearInkStrokes(); // preserve background text
        } else {
          this.engine?.clearStrokes();
        }
        this.isDirty = false;
      }).open();
    });

    // Convert to text
    const convertBtn = this.toolbar.createEl("button", {
      cls: "pencil-action-btn pencil-convert-btn",
      text: "Convert to Text",
      attr: { title: "Convert handwriting to markdown text" },
    });
    convertBtn.addEventListener("click", () => this.convertToText());

    // Back to note
    const backBtn = this.toolbar.createEl("button", { cls: "pencil-action-btn", text: "← Note", attr: { title: "Return to note editor" } });
    backBtn.addEventListener("click", () => this.returnToNote());
  }

  private buildCanvas(container: HTMLElement) {
    const wrapper = container.createDiv({ cls: "pencil-canvas-wrapper" });
    this.canvas = wrapper.createEl("canvas", { cls: "pencil-canvas" });

    const dpr = window.devicePixelRatio || 1;
    const rect = wrapper.getBoundingClientRect();
    const cssWidth = Math.max(rect.width || window.innerWidth, 200);
    const cssHeight = Math.max(rect.height || window.innerHeight - 60, 200);
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;
    this.canvas.style.width = cssWidth + "px";
    this.canvas.style.height = cssHeight + "px";

    this.engine = new StrokeEngine(this.canvas);
    // Use theme-aware default color unless user has customized it
    const isDark = document.body.classList.contains("theme-dark");
    const defaultColor = this.settings.defaultPenColor === "#000000" && isDark
      ? "#ffffff"
      : this.settings.defaultPenColor;
    this.engine.setColor(defaultColor);
    this.engine.setWidth(this.settings.defaultPenWidth);
    this.engine.onChange(() => { this.isDirty = true; });
  }

  private handleResize() {
    if (!this.canvas || !this.engine) return;
    const wrapper = this.canvas.parentElement!;
    const rect = wrapper.getBoundingClientRect();
    this.engine.resize(rect.width, rect.height - 60);
  }

  private async loadExistingContent() {
    if (!this.engine) return;
    const content = await this.app.vault.read(this.noteFile);
    this.noteParts = splitNoteForCanvas(content);
    const isDark = document.body.classList.contains("theme-dark");
    this.engine.renderExistingText(this.noteParts.editableBody, isDark);
    this.isEditMode = content.length > 0;
  }

  private async loadDraft() {
    const draft = await this.draftStore.load(this.noteFile);
    if (draft && this.engine) {
      // Only restore ink strokes — text strokes come from the current note content
      const inkStrokes = draft.strokes.filter(s => s.tool !== "text");
      if (inkStrokes.length > 0) {
        this.engine.appendStrokes(inkStrokes);
      }
    }
  }

  async saveDraft() {
    if (!this.engine || !this.canvas) return;
    if (!this.engine.hasStrokes()) {
      await this.draftStore.delete(this.noteFile);
      return;
    }
    await this.draftStore.save(
      this.noteFile,
      this.engine.getStrokes(),
      this.canvas.width,
      this.canvas.height
    );
  }

  private async convertToText() {
    if (!this.engine || !this.canvas) return;
    if (!this.engine.hasStrokes()) {
      new Notice("Nothing to convert.");
      return;
    }
    if (this.isConverting) return;

    this.isConverting = true;
    const convertBtn = this.toolbar?.querySelector(".pencil-convert-btn") as HTMLButtonElement;
    if (convertBtn) {
      convertBtn.textContent = "Converting…";
      convertBtn.disabled = true;
    }

    try {
      this.syncOCRProvider();
      let text: string;
      const keys = this.resolveOCRKeys();

      if (this.isEditMode) {
        // Reconstruct surviving text directly from text strokes — never loses content to OCR color issues.
        const reconstructed = this.engine.getReconstructedText();

        // OCR only the ink strokes (handwritten additions), if any exist.
        const inkImageUrl = this.engine.getInkOnlyImageDataUrl();
        let inkText = "";
        if (inkImageUrl) {
          inkText = await this.ocrEngine.recognize(inkImageUrl, keys);
        }

        text = reconstructed;
        if (inkText) {
          text = text + (text ? "\n\n" : "") + inkText;
        }

        if (!text && !this.noteParts.protectedPrefix) {
          new Notice("No text to save.");
          return;
        }

        await this.app.vault.process(this.noteFile, () => mergeCanvasBody(this.noteParts, text));
      } else {
        const imageDataUrl = this.engine.getCanvasImageDataUrl();
        text = await this.ocrEngine.recognize(imageDataUrl, keys);

        if (!text) {
          new Notice("No text recognized. Try writing more clearly.");
          return;
        }

        await this.insertTextIntoNote(text);
      }

      this.engine.clearStrokes();
      await this.draftStore.delete(this.noteFile);
      this.isDirty = false;
      this.isEditMode = false;
      new Notice("Note updated.");
      this.returnToNote();
    } catch (err) {
      console.error("OCR error:", err);
      new Notice(`Conversion failed: ${(err as Error).message}`);
    } finally {
      this.isConverting = false;
      if (convertBtn) {
        convertBtn.textContent = "Convert to Text";
        convertBtn.disabled = false;
      }
    }
  }

  private resolveOCRKeys(): OCRKeys {
    const s = this.app.secretStorage;
    return {
      openai: this.settings.openaiSecretId ? (s.getSecret(this.settings.openaiSecretId) ?? "") : "",
      google: this.settings.googleSecretId ? (s.getSecret(this.settings.googleSecretId) ?? "") : "",
      claude: this.settings.claudeSecretId ? (s.getSecret(this.settings.claudeSecretId) ?? "") : "",
      gemini: this.settings.geminiSecretId ? (s.getSecret(this.settings.geminiSecretId) ?? "") : "",
    };
  }

  private syncOCRProvider() {
    const provider = this.settings.ocrProvider;
    if (provider !== this.activeOCRProvider) {
      this.ocrEngine.setProvider(provider);
      this.activeOCRProvider = provider;
    }
    this.updateOCRStatus();
  }

  private updateOCRStatus() {
    if (!this.ocrStatusEl) return;
    this.ocrStatusEl.textContent = `OCR: ${this.getOCRProviderLabel(this.settings.ocrProvider)}`;
  }

  private getOCRProviderLabel(provider: OCRProvider): string {
    switch (provider) {
      case "openai":
        return "OpenAI GPT-4o";
      case "google":
        return "Google Vision";
      case "claude":
        return "Claude";
      case "gemini":
        return "Gemini";
      case "tesseract":
      default:
        return "On-device Tesseract";
    }
  }

  private applyStrikethroughs(text: string): string {
    if (!this.engine) return text;
    return applyStrikethroughs(
      text,
      this.engine.getStrikethroughRegions(),
      (y) => this.engine!.getTextLineIndexAtY(y)
    );
  }

  private async insertTextIntoNote(text: string) {
    await this.app.vault.process(this.noteFile, (content) => {
      switch (this.settings.insertionMode) {
        case "append":
          return content + (content.endsWith("\n") ? "" : "\n") + text + "\n";
        case "newline":
        default:
          return content + (content.length > 0 ? "\n\n" : "") + text + "\n";
      }
    });
  }

  private returnToNote() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const existing = leaves.find(
      (l) => (l.view as MarkdownView).file?.path === this.noteFile.path
    );
    if (existing) {
      this.app.workspace.setActiveLeaf(existing, { focus: true });
    } else {
      this.app.workspace.openLinkText(this.noteFile.path, "", false);
    }
  }

  async onClose() {
    if (this.isDirty && this.settings.autosaveOnExit) {
      await this.saveDraft();
    }
    this.engine?.destroy();
    await this.ocrEngine.destroy();
  }
}
