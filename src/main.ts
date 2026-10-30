import { MarkdownView, Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	FumenSettings,
	FumenSettingTab,
} from './settings';
import { FumenView, VIEW_TYPE_FUMEN } from './view';

export default class FumenPlugin extends Plugin {
	settings!: FumenSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_FUMEN, (leaf) => new FumenView(leaf, this));

		this.addRibbonIcon('music', 'Render note as fumen chart', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'render-current-note',
			name: 'Render current note as chord chart',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'export-chart-png',
			name: 'Export chord chart as PNG',
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FUMEN)[0];
				if (!(leaf?.view instanceof FumenView)) return false;
				if (!checking) void leaf.view.exportPng();
				return true;
			},
		});

		this.addCommand({
			id: 'download-mdproject',
			name: 'Download current note as mdproject',
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FUMEN)[0];
				if (!(leaf?.view instanceof FumenView)) return false;
				if (!checking) void leaf.view.downloadMdProject();
				return true;
			},
		});

		this.addSettingTab(new FumenSettingTab(this.app, this));
	}

	async activateView() {
		const source = this.app.workspace.getActiveViewOfType(MarkdownView);
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FUMEN)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('split', 'vertical');
			await leaf.setViewState({ type: VIEW_TYPE_FUMEN, active: true });
		}
		await workspace.revealLeaf(leaf);

		if (source?.file && leaf.view instanceof FumenView) {
			leaf.view.setFile(source.file);
		}
	}

	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FUMEN)) {
			if (leaf.view instanceof FumenView) void leaf.view.render();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<FumenSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
