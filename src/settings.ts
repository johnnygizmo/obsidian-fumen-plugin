import { App, PluginSettingTab, Setting } from 'obsidian';
import type FumenPlugin from './main';

export interface FumenSettings {
	textSize: number;
}

export const DEFAULT_SETTINGS: FumenSettings = {
	textSize: 1,
};

export class FumenSettingTab extends PluginSettingTab {
	plugin: FumenPlugin;

	constructor(app: App, plugin: FumenPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Chart size')
			.setDesc('Scale of the rendered chart (default 1).')
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 2, 0.1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.textSize)
					.onChange(async (value) => {
						this.plugin.settings.textSize = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);
	}
}
