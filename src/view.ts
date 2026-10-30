import {
	debounce,
	ItemView,
	MarkdownView,
	Notice,
	normalizePath,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import { DefaultRenderer, Parser } from 'fumen/dist/fumen.js';
import { buildMdProject } from './mdproject';
import type FumenPlugin from './main';

export const VIEW_TYPE_FUMEN = 'fumen-chart-view';

export class FumenView extends ItemView {
	private file: TFile | null = null;
	private renderToken = 0;
	private chartEl!: HTMLElement;
	private canvas: HTMLCanvasElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: FumenPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_FUMEN;
	}

	getDisplayText(): string {
		return this.file ? `Fumen: ${this.file.basename}` : 'Fumen chart';
	}

	getIcon(): string {
		return 'music';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('fumen-view');
		this.chartEl = this.contentEl.createDiv({ cls: 'fumen-chart' });

		this.addAction('download', 'Export as PNG', () => {
			void this.exportPng();
		});
		this.addAction('file-down', 'Download as mdproject', () => {
			void this.downloadMdProject();
		});

		const requestRender = debounce(() => void this.render(), 200, true);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView && leaf.view.file) {
					this.setFile(leaf.view.file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file === this.file) requestRender();
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file === this.file) this.setFile(null);
			}),
		);

		const observer = new ResizeObserver(() => requestRender());
		observer.observe(this.contentEl);
		this.register(() => observer.disconnect());

		const active = this.app.workspace.getActiveFile();
		this.setFile(active?.extension === 'md' ? active : null);
	}

	onClose(): Promise<void> {
		this.renderToken++;
		return Promise.resolve();
	}

	setFile(file: TFile | null): void {
		this.file = file;
		void this.render();
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const file = this.file;

		if (!file) {
			this.showMessage('Open a note to render it as a Fumen chart.');
			return;
		}

		const raw = await this.app.vault.cachedRead(file);
		const code = this.stripFrontmatter(file, raw);

		const width = Math.floor(this.contentEl.clientWidth) - 20;
		if (width <= 0) return;

		try {
			const track = new Parser().parse(code);
			const canvas = createEl('canvas');
			await new DefaultRenderer(canvas, {
				paper_width: width,
				paper_height: 0,
				text_size: this.plugin.settings.textSize,
			}).render(track);

			if (token !== this.renderToken) return;
			this.chartEl.empty();
			this.chartEl.appendChild(canvas);
			this.canvas = canvas;
		} catch (e) {
			if (token !== this.renderToken) return;
			this.showMessage(
				`Could not render chart: ${e instanceof Error ? e.message : String(e)}`,
				true,
			);
		}
	}

	async exportPng(): Promise<void> {
		const { file, canvas } = this;
		if (!file || !canvas) {
			new Notice('No rendered chart to export.');
			return;
		}

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/png'),
		);
		if (!blob) {
			new Notice('Could not export the chart.');
			return;
		}

		const data = await blob.arrayBuffer();
		const dir = file.parent?.path ?? '';
		const path = normalizePath(`${dir}/${file.basename}.png`);
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, data);
		} else {
			await this.app.vault.createBinary(path, data);
		}
		new Notice(`Exported chart to ${path}`);
	}

	async downloadMdProject(): Promise<void> {
		const file = this.file;
		if (!file) {
			new Notice('Open a note to export.');
			return;
		}

		let text: string;
		try {
			const raw = await this.app.vault.cachedRead(file);
			const track = new Parser().parse(this.stripFrontmatter(file, raw));
			text = buildMdProject(track, file.basename);
		} catch (e) {
			new Notice(
				`Could not export: ${e instanceof Error ? e.message : String(e)}`,
			);
			return;
		}

		const url = URL.createObjectURL(
			new Blob([text], { type: 'application/json' }),
		);
		const link = activeDocument.body.createEl('a', {
			attr: { href: url, download: `${file.basename}.mdproject` },
		});
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	private stripFrontmatter(file: TFile, raw: string): string {
		const end =
			this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end
				.offset;
		return end === undefined ? raw : raw.slice(end);
	}

	private showMessage(text: string, isError = false): void {
		this.canvas = null;
		this.chartEl.empty();
		this.chartEl.createDiv({
			text,
			cls: isError ? 'fumen-message fumen-error' : 'fumen-message',
		});
	}
}
