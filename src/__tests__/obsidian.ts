export async function requestUrl() {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: {},
    text: "",
  };
}

function decorateElement<T extends HTMLElement>(element: T): T {
  const el = element as any;

  el.createDiv ??= (options: { cls?: string; text?: string } = {}) => {
    const child = decorateElement(document.createElement("div"));
    if (options.cls) child.className = options.cls;
    if (options.text) child.textContent = options.text;
    el.appendChild(child);
    return child;
  };

  el.createEl ??= (
    tag: string,
    options: { cls?: string; text?: string; attr?: Record<string, string>; type?: string } = {}
  ) => {
    const child = decorateElement(document.createElement(tag));
    if (options.cls) child.className = options.cls;
    if (options.text) child.textContent = options.text;
    if (options.type) child.setAttribute("type", options.type);
    for (const [key, value] of Object.entries(options.attr ?? {})) {
      child.setAttribute(key, value);
    }
    el.appendChild(child);
    return child;
  };

  el.addClass ??= (...classes) => {
    el.classList.add(...classes);
  };

  el.removeClass ??= (...classes) => {
    el.classList.remove(...classes);
  };

  el.empty ??= () => {
    el.replaceChildren();
  };

  return element;
}

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export class App {
  vault: any;
  workspace: any;
  secretStorage: any;
}

export class TFile {
  path: string;
  basename: string;

  constructor(path: string, basename: string) {
    this.path = path;
    this.basename = basename;
  }
}

export class WorkspaceLeaf {
  app: App;
  view: any;

  constructor(app: App) {
    this.app = app;
    this.view = {
      containerEl: decorateElement(document.createElement("div")),
    };
  }

  detach() {}
  async setViewState() {}
}

export class MarkdownView {
  file: TFile | null;
  containerEl: HTMLElement;

  constructor(file: TFile | null = null) {
    this.file = file;
    this.containerEl = decorateElement(document.createElement("div"));
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = decorateElement(document.createElement("div"));
  }

  open() {
    const modal = this as unknown as { onOpen?: () => void };
    if (typeof modal.onOpen === "function") {
      modal.onOpen();
    }
  }

  close() {
    const modal = this as unknown as { onClose?: () => void };
    if (typeof modal.onClose === "function") {
      modal.onClose();
    }
  }
}

export class ItemView {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = decorateElement(document.createElement("div"));
    this.containerEl.appendChild(decorateElement(document.createElement("div")));
    this.containerEl.appendChild(decorateElement(document.createElement("div")));
  }

  registerEvent() {}
  register() {}
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  if (!content.startsWith("---")) {
    return {
      exists: false,
      frontmatter: "",
      from: 0,
      to: 0,
      contentStart: 0,
    };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || match.index !== 0) {
    return {
      exists: false,
      frontmatter: "",
      from: 0,
      to: 0,
      contentStart: 0,
    };
  }

  const frontmatter = match[1];
  const from = content.indexOf(frontmatter);
  const to = from + frontmatter.length;

  return {
    exists: true,
    frontmatter,
    from,
    to,
    contentStart: match[0].length,
  };
}
