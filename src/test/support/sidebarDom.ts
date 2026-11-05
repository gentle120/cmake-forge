/**
 * Minimal HTML/DOM shim for sidebar webview tests.
 *
 * The extension package must not gain a DOM dependency, and the sidebar markup
 * is a small, well-formed subset, so the tests parse the rendered shell and run
 * the real `main.js` against this shim. It implements only what the renderer
 * uses: element lookup, class/attribute reflection, native control properties,
 * listener dispatch and ancestor matching.
 */

const voidTags: Record<string, true> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  source: true,
  track: true,
  wbr: true
};

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export class Element {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: Array<Element | string> = [];
  parent: Element | undefined;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  ownerDocument: Document;
  value = '';
  checked = false;
  title = '';
  type = '';
  spellcheck = false;
  autocomplete = '';
  autocapitalize = '';
  placeholder = '';

  constructor(tagName: string, ownerDocument: Document) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
  }

  get id(): string {
    return this.attributes.get('id') ?? '';
  }

  get className(): string {
    return this.attributes.get('class') ?? '';
  }

  set className(value: string) {
    this.attributes.set('class', value);
  }

  get classList() {
    const element = this;
    return {
      contains(name: string): boolean {
        return element.className.split(/\s+/).filter(Boolean).includes(name);
      },
      add(name: string): void {
        element.className = [...new Set([...element.className.split(/\s+/).filter(Boolean), name])].join(' ');
      },
      remove(name: string): void {
        element.className = element.className.split(/\s+/).filter((item) => item && item !== name).join(' ');
      },
      toggle(name: string, force?: boolean): boolean {
        const active = force ?? !this.contains(name);
        if (active) this.add(name);
        else this.remove(name);
        return active;
      }
    };
  }

  get dataset(): Record<string, string> {
    const element = this;
    return new Proxy({} as Record<string, string>, {
      get(_target, key: string): string {
        return element.attributes.get(`data-${String(key)}`) ?? '';
      },
      set(_target, key: string, value: string): boolean {
        element.attributes.set(`data-${String(key)}`, String(value));
        return true;
      },
      has(_target, key: string): boolean {
        return element.attributes.has(`data-${String(key)}`);
      },
      deleteProperty(_target, key: string): boolean {
        element.attributes.delete(`data-${String(key)}`);
        return true;
      }
    });
  }

  get hidden(): boolean {
    return this.attributes.has('hidden');
  }

  set hidden(value: boolean) {
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  get disabled(): boolean {
    return this.attributes.has('disabled');
  }

  set disabled(value: boolean) {
    if (value) this.attributes.set('disabled', '');
    else this.attributes.delete('disabled');
  }

  get isConnected(): boolean {
    let node: Element | undefined = this;
    while (node.parent) node = node.parent;
    return node === this.ownerDocument.root;
  }

  get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  set textContent(value: string) {
    this.children.length = 0;
    if (value) this.children.push(String(value));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: Array<Element | string>): void {
    nodes.forEach((node) => {
      if (typeof node !== 'string') node.parent = this;
      this.children.push(node);
    });
  }

  replaceChildren(...nodes: Array<Element | string>): void {
    this.children.length = 0;
    this.append(...nodes);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const payload = { type, target: this, preventDefault() {}, ...event };
    // Real DOM events bubble, so delegated listeners on #app must observe a
    // click dispatched on a descendant control.
    let node: Element | undefined = this;
    while (node) {
      (node.listeners.get(type) ?? []).forEach((listener) => {
        listener({ ...payload, currentTarget: node });
      });
      node = node.parent;
    }
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  closest(selector: string): Element | undefined {
    let node: Element | undefined = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return undefined;
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => this.matchesOne(part.trim()));
  }

  private matchesOne(selector: string): boolean {
    const attribute = /^([a-z0-9]*)\[([a-z-]+)\]$/i.exec(selector);
    if (attribute) {
      const [, tag, name] = attribute;
      return (!tag || this.tagName === tag.toLowerCase()) && this.attributes.has(name);
    }
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1));
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelector(selector: string): Element | undefined {
    return this.querySelectorAll(selector)[0];
  }

  querySelectorAll(selector: string): Element[] {
    const found: Element[] = [];
    const visit = (node: Element): void => {
      node.children.forEach((child) => {
        if (typeof child === 'string') return;
        if (child.matches(selector)) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }
}

export class Document {
  root = new Element('#document', this);
  activeElement: Element | undefined;
  body = new Element('body', this);

  constructor() {
    this.root.append(this.body);
  }

  createElement(tagName: string): Element {
    return new Element(tagName, this);
  }

  createTextNode(text: string): string {
    return String(text);
  }

  getElementById(id: string): Element | undefined {
    return this.root.querySelectorAll(`#${id}`)[0]
      ?? this.findAll(this.root).find((element) => element.id === id);
  }

  hasFocus(): boolean {
    return true;
  }

  private findAll(node: Element): Element[] {
    const found: Element[] = [];
    node.children.forEach((child) => {
      if (typeof child === 'string') return;
      found.push(child, ...this.findAll(child));
    });
    return found;
  }
}

/** Parses the constrained sidebar markup into a shim DOM tree. */
export function parseHtml(markup: string, document: Document): Element {
  const body = document.body;
  const stack: Element[] = [body];
  const tokenPattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(markup))) {
    const token = match[0];
    if (token.startsWith('<!') || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const tagMatch = /^<([a-zA-Z0-9-]+)/.exec(token);
      if (!tagMatch) continue;
      const element = document.createElement(tagMatch[1]);
      const attributePattern = /([a-zA-Z:@][-a-zA-Z0-9:@.]*)(?:\s*=\s*"([^"]*)")?/g;
      const openTag = token.slice(1 + tagMatch[1].length, token.length - 1);
      let attribute: RegExpExecArray | null;
      while ((attribute = attributePattern.exec(openTag))) {
        const [, name, value] = attribute;
        element.setAttribute(name, decode(value ?? ''));
      }
      stack[stack.length - 1].append(element);
      if (!voidTags[element.tagName]) stack.push(element);
      continue;
    }
    const text = token.trim();
    if (text) stack[stack.length - 1].append(decode(text));
  }
  return body;
}
