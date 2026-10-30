declare module 'fumen/dist/fumen.js' {
	export type RenderParam = Record<string, unknown>;

	export class Parser {
		parse(code: string): unknown;
	}

	export class DefaultRenderer {
		constructor(canvas: HTMLElement, param?: RenderParam);
		render(track: unknown, param?: RenderParam): Promise<void>;
	}
}
