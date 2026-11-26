/**
 * helpers/dom.js - a small DOM shim for the dashboard pages.
 *
 * The pages are plain ES modules that import the same src modules the test
 * suite runs. This shim implements just enough of the DOM to execute those
 * inline scripts under node:test, so the UI tests check rendered output and
 * event handlers rather than only static markup. It has no dependency on any
 * package; SVG elements are created with createElementNS just as in a browser.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) { for (const n of names) this.set.add(n); }
  remove(...names) { for (const n of names) this.set.delete(n); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.set.has(name) : Boolean(force);
    if (next) this.set.add(name); else this.set.delete(name);
    return next;
  }
  toString() { return [...this.set].join(" "); }
}

export class El {
  constructor(tag = "div", id = "", ns = "") {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.ns = ns;
    this.textContent = "";
    this._innerHTML = "";
    this.value = "";
    this.type = "";
    this.min = "";
    this.max = "";
    this.step = "";
    this.tabIndex = 0;
    this.hidden = false;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.style = {
      setProperty() {},
      width: "",
      color: ""
    };
    this.classList = new ClassList(this);
    this.scrollTop = 0;
    this.scrollHeight = 400;
    this.clientHeight = 200;
  }
  get className() { return this.classList.toString(); }
  set className(value) {
    this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    // The shim does not parse HTML into a tree, but it records the markup so
    // assertions can inspect generated table rows, ledger cards and SVG nodes.
  }
  get firstChild() { return this.children[0] ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === "object" && node instanceof El) {
        node.parentNode = this;
        this.children.push(node);
      }
    }
  }
  appendChild(node) { this.append(node); return node; }
  prepend(node) { this.children.unshift(node); node.parentNode = this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  before(node) {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    this.parentNode.children.splice(Math.max(0, idx), 0, node);
    node.parentNode = this.parentNode;
  }
  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      if (node === this) {
        for (const child of node.children) walk(child);
        return;
      }
      if (matches(node, selector)) out.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return out;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  focus() { this.focused = true; }
  get text() { return this.textContent || this.children.map((c) => c.text).join(""); }
}

function matches(node, selector) {
  for (const part of selector.split(",")) {
    const sel = part.trim();
    if (sel.startsWith("[") && sel.endsWith("]")) {
      const body = sel.slice(1, -1);
      const eq = body.indexOf("=");
      if (eq === -1) {
        if (Object.prototype.hasOwnProperty.call(node.attrs, body)) return true;
      } else {
        const key = body.slice(0, eq);
        const value = body.slice(eq + 1).replace(/^["']|["']$/g, "");
        if (node.getAttribute(key) === value || (key.startsWith("data-") && node.dataset[key.slice(5)] === value)) return true;
      }
    } else if (sel.startsWith(".") && node.classList.contains(sel.slice(1))) return true;
    else if (sel.startsWith("#") && node.id === sel.slice(1)) return true;
    else if (node.tagName === sel.toUpperCase()) return true;
  }
  return false;
}

export function parsePage(relativePath) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const chips = [...source.matchAll(/<button class="chip"[^>]*data-q="([^"]+)"/g)].map((m) => m[1]);
  const navs = [...source.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);
  const scripts = [...source.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // Static attributes of form controls, so the shim starts from the same
  // values a browser would after parsing the markup.
  const attributes = new Map();
  for (const match of source.matchAll(/<(input|select|button|output|table|tbody|svg)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of match[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (attrs.id) attributes.set(attrs.id, { tag: match[1], attrs });
  }
  return { source, ids, chips, navs, scripts, attributes, relativePath };
}

/**
 * Build a fake document for one page. Every id in the static markup becomes an
 * element, plus data-q chips, data-nav links and data-action controls. The
 * returned env can be installed and restored around an inline script import.
 */
export function makeDom(page, options = {}) {
  const elements = new Map();
  const add = (tag, id) => {
    const el = new El(tag, id);
    elements.set(id, el);
    return el;
  };
  for (const id of page.ids) {
    const spec = page.attributes?.get(id);
    const el = add(spec?.tag ?? "div", id);
    if (spec) {
      for (const [key, value] of Object.entries(spec.attrs)) {
        el.setAttribute(key, value);
        if (key === "value") el.value = value;
        if (key === "hidden") el.hidden = true;
        if (key === "class") el.className = value;
      }
    }
  }
  for (const [i, q] of page.chips.entries()) {
    const chip = add("button", `chip-${i}`);
    chip.dataset.q = q;
    chip.setAttribute("data-q", q);
    chip.className = "chip";
  }
  for (const [i, nav] of page.navs.entries()) {
    const link = add("a", `nav-${i}`);
    link.setAttribute("data-nav", nav);
  }
  // Structural elements that the scripts query by selector.
  const docRoot = new El("html");
  docRoot.classList = new ClassList(docRoot);
  const bodyEl = new El("body");
  bodyEl.dataset.page = options.page ?? "";
  docRoot.append(bodyEl);

  const existingChips = [...elements.values()].filter((el) => el.className.includes("chip"));
  for (const chip of existingChips) bodyEl.append(chip);
  const existingNavs = [...elements.values()].filter((el) => el.getAttribute("data-nav"));
  for (const link of existingNavs) bodyEl.append(link);

  const document = {
    documentElement: docRoot,
    body: bodyEl,
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new El(tag),
    createElementNS: (ns, tag) => new El(tag, "", ns),
    querySelector: (sel) => bodyEl.querySelector(sel) ?? docRoot.querySelector(sel),
    querySelectorAll: (sel) => [...bodyEl.querySelectorAll(sel), ...docRoot.querySelectorAll(sel)],
    addEventListener: (type, fn) => (document._listeners[type] ??= []).push(fn),
    _listeners: {},
    readyState: "complete"
  };
  const storage = new Map();
  const localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  const location = {
    hash: options.hash ?? "",
    href: options.href ?? "http://localhost/",
    pathname: options.pathname ?? "/",
    search: options.search ?? ""
  };
  const history = {
    replaceState(_a, _b, url) {
      if (typeof url === "string") {
        const hashIndex = url.indexOf("#");
        location.hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
        if (!url.startsWith("#")) location.href = url;
        else location.href = location.href.split("#")[0] + url;
      }
    },
    pushState() {}
  };
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage,
    location,
    history,
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
    fire(type, extra = {}) {
      const event = { target: this, preventDefault() {}, ...extra };
      for (const fn of this._listeners[type] ?? []) fn(event);
      return event;
    },
    print() { window.printed = true; },
    printed: false
  };
  const globals = {
    document,
    window,
    localStorage,
    location,
    history,
    console,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { fn(0); return 0; },
    navigator: { clipboard: { writeText: async () => {} } }
  };
  return { document, window, elements, globals, getEl: (id) => elements.get(id) ?? null };
}

/**
 * Execute one inline module script in a vm context whose dynamic import
 * resolves relative to the page directory, exactly as a browser would.
 */
export async function runInlineScript(page, env, scriptIndex = 0) {
  const script = page.scripts[scriptIndex];
  const pageDir = path.dirname(path.join(repoRoot, page.relativePath));
  const moduleUrl = pathToFileURL(path.join(pageDir, "__inline__.mjs")).href;
  const context = vm.createContext(env.globals);
  const imports = [];
  const rewritten = script.replace(/await\s+import\((["'])([^"']+)\1\)/g, (_all, _quote, specifier) => {
    imports.push(new URL(specifier, moduleUrl).href);
    return `__inlineModules[${imports.length - 1}]`;
  });
  env.globals.__inlineModules = await Promise.all(imports.map((href) => import(href)));
  const result = vm.runInContext(`(async () => {${rewritten}\n})()`, context, { filename: moduleUrl });
  await result;
  return { namespace: {} };
}

