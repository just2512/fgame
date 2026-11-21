import storyJson from "./content/sudden-billionaire.json";
import { chooseOption, getCurrentEvent, getAvailableChoices, startGame } from "./engine/engine";
import { assertValidStory } from "./engine/validation";
import { loadSave, saveGame } from "./engine/storage";
import type { GameState, StoryDefinition, StoryEvent } from "./engine/types";
import "./styles.css";

const story = storyJson as StoryDefinition;
const root = document.querySelector<HTMLDivElement>("#app");

if (!root) throw new Error("App root element was not found");
assertValidStory(story);

let gameState: GameState | null = null;
let savedState: GameState | null = null;
let saveError = "";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

function paragraphs(value: string): string {
  return value.split(/\n\n+/).map((part) => "<p>" + escapeHtml(part) + "</p>").join("");
}

function newSeed(): string {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return String(values[0]);
}

function renderHome(): void {
  const continueButton = savedState && savedState.storyId === story.id && savedState.storyVersion === story.version
    ? '<button class="button button-primary" data-action="continue">继续上次的人生</button>'
    : "";
  const warning = saveError ? '<p class="notice">' + escapeHtml(saveError) + "</p>" : "";

  root.innerHTML = `
    <main class="shell home-shell">
      <div class="topline"><span>INTERACTIVE FICTION</span><span>OFFLINE STORY</span></div>
      <section class="hero">
        <div class="hero-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="eyebrow">一段由自己选择推动的人生</p>
        <h1>突然成为<br /><em>百亿富二代</em></h1>
        <p class="hero-copy">昨天，你还在为季度目标发愁。今天，你继承了庞大的家族资产，却发现真正难的事情才刚刚开始。</p>
        <div class="story-tags"><span>现代都市</span><span>人生选择</span><span>多种走向</span></div>
        <div class="home-actions">${continueButton}<button class="button ${continueButton ? "button-secondary" : "button-primary"}" data-action="new">开始新故事</button></div>
        ${warning}
      </section>
      <footer class="footer-note"><span>人生一程</span><span>本地存档 · 无需账号</span></footer>
    </main>
  `;
}

function renderLastResult(): string {
  if (!gameState?.lastResult) return "";
  const result = gameState.lastResult;
  return `
    <aside class="last-result">
      <span class="result-label">刚刚发生</span>
      <strong>${escapeHtml(result.eventTitle)}</strong>
      <p>${escapeHtml(result.narrative)}</p>
    </aside>
  `;
}

function renderScene(event: StoryEvent): void {
  if (!gameState) return;
  const choices = getAvailableChoices(event, gameState);
  const choiceHtml = choices.map((choice, index) => `
    <button class="choice" data-choice-id="${escapeHtml(choice.id)}">
      <span class="choice-letter">${String.fromCharCode(65 + index)}</span>
      <span class="choice-text">${escapeHtml(choice.text)}</span>
      <span class="choice-arrow" aria-hidden="true">↗</span>
    </button>
  `).join("");

  root.innerHTML = `
    <main class="shell story-shell">
      <header class="story-topbar">
        <a class="wordmark" href="#" data-action="home">人生一程</a>
        <span class="chapter-label">第一章 · 继承之初</span>
        <button class="text-button" data-action="new">重新开始</button>
      </header>
      ${renderLastResult()}
      <article class="story-card">
        <div class="scene-kicker">THE NEXT CHOICE</div>
        <h1>${escapeHtml(event.title)}</h1>
        <div class="scene-copy">${paragraphs(event.scene)}</div>
        <div class="choice-divider"><span>你准备怎么做？</span></div>
        <div class="choices">${choiceHtml}</div>
      </article>
      <footer class="footer-note"><span>故事会记住你的选择</span><span>进度自动保存在本机</span></footer>
    </main>
  `;
}

function renderEnding(event: StoryEvent): void {
  if (!gameState) return;
  const history = gameState.history.slice(-4).reverse();
  const historyHtml = history.map((record) => `
    <li><strong>${escapeHtml(record.eventTitle)}</strong><span>${escapeHtml(record.choiceText)}</span></li>
  `).join("");

  root.innerHTML = `
    <main class="shell ending-shell">
      <div class="topline"><span>THE FIRST CHAPTER</span><span>YOUR STORY</span></div>
      <section class="ending-card">
        <p class="eyebrow">这一程的结果</p>
        <div class="ending-rule"></div>
        <h1>${escapeHtml(event.title)}</h1>
        <div class="ending-copy">${paragraphs(event.scene)}</div>
        ${event.reflection ? '<blockquote>' + escapeHtml(event.reflection) + "</blockquote>" : ""}
      </section>
      <section class="recap">
        <p class="eyebrow">回望这一路</p>
        <ol>${historyHtml}</ol>
      </section>
      <div class="ending-actions"><button class="button button-primary" data-action="new">再经历一次</button><button class="button button-secondary" data-action="home">返回首页</button></div>
      <footer class="footer-note"><span>人生一程</span><span>不同选择，会走向不同经历</span></footer>
    </main>
  `;
}

function renderGame(): void {
  if (!gameState) {
    renderHome();
    return;
  }
  const event = getCurrentEvent(gameState, story);
  if (event.kind === "ending" || gameState.ended) {
    renderEnding(event);
  } else {
    renderScene(event);
  }
}

async function beginNewStory(): Promise<void> {
  gameState = startGame(story, newSeed());
  savedState = gameState;
  saveError = "";
  try {
    await saveGame(gameState);
  } catch (error) {
    saveError = error instanceof Error ? error.message : "无法保存本地进度";
  }
  renderGame();
}

async function continueStory(): Promise<void> {
  if (!savedState || savedState.storyId !== story.id || savedState.storyVersion !== story.version) return;
  gameState = savedState;
  renderGame();
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const choiceButton = target.closest<HTMLButtonElement>("[data-choice-id]");
  if (choiceButton && gameState) {
    const choiceId = choiceButton.dataset.choiceId;
    if (!choiceId) return;
    root.querySelectorAll<HTMLButtonElement>("[data-choice-id]").forEach((button) => { button.disabled = true; });
    try {
      gameState = chooseOption(gameState, story, choiceId);
      savedState = gameState;
      await saveGame(gameState);
      saveError = "";
      renderGame();
    } catch (error) {
      saveError = error instanceof Error ? error.message : "处理选择时发生错误";
      renderGame();
    }
    return;
  }

  const actionButton = target.closest<HTMLElement>("[data-action]");
  const action = actionButton?.dataset.action;
  if (!action) return;

  if (action === "new") {
    if (gameState && !gameState.ended && !globalThis.confirm("重新开始会覆盖当前设备上的故事进度。继续吗？")) return;
    await beginNewStory();
  } else if (action === "continue") {
    await continueStory();
  } else if (action === "home") {
    gameState = null;
    renderHome();
  }
}

root.addEventListener("click", (event) => { void handleClick(event); });

async function boot(): Promise<void> {
  try {
    savedState = await loadSave();
    if (savedState && (savedState.storyId !== story.id || savedState.storyVersion !== story.version)) {
      saveError = "检测到其他版本的存档。为避免错误读取，本次原型不会自动载入该存档。";
      savedState = null;
    }
  } catch (error) {
    saveError = error instanceof Error ? error.message : "本地存档暂不可用";
  }
  renderHome();
}

async function warmOfflineCache(): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    if (!("caches" in globalThis)) return;
    const cache = await caches.open("fgame-shell-v1");
    const resources = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => {
        try { return new URL(name).origin === location.origin; } catch { return false; }
      });
    const uniqueUrls = [...new Set(resources)];
    await Promise.all(uniqueUrls.map((url) => cache.add(url).catch(() => undefined)));
  } catch {
    // Online play remains available when browser storage or service workers are restricted.
  }
}

window.addEventListener("load", () => { void warmOfflineCache(); });
void boot();
