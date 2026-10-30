// Exports a parsed Fumen track as a tunepad/MorningDaw .mdproject file (title, author, key, chords, sections).

interface FumenNode {
	childNodes?: FumenNode[];
	[key: string]: unknown;
}

interface ExportChord {
	start: number;
	length: number;
	root: number;
	quality: string;
	bass: number | null;
}

interface ExportMeter {
	row: number;
	num: number;
	den: number;
}

interface ExportMarker {
	start: number;
	name: string;
}

// Section colors tunepad uses for its named section kinds; anything else is grey.
const SECTION_COLORS: [RegExp, number][] = [
	[/^\s*intro\b/i, 0xff78909c],
	[/^\s*verse\b/i, 4282960620],
	[/^\s*chorus\b/i, 4282160880],
	[/^\s*bridge\b/i, 4284534392],
	[/^\s*outro\b/i, 0xff8d6e63],
];

const sectionColor = (name: string): number =>
	SECTION_COLORS.find(([re]) => re.test(name))?.[1] ?? 0xff9e9e9e;

// Fumen stores durations as a fraction of a whole note scaled by 17297280; a whole note is 16 rows.
const FUMEN_UNITS_PER_ROW = 1081080;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const LETTER_PITCH: Record<string, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

function pitchClass(letter: unknown, accidental: unknown): number | null {
	const base = LETTER_PITCH[str(letter).toUpperCase()];
	if (base === undefined) return null;
	let offset = 0;
	for (const c of str(accidental)) {
		if (c === '#') offset += 1;
		if (c === 'b') offset -= 1;
	}
	return (((base + offset) % 12) + 12) % 12;
}

function qualityId(mid: string): string {
	const m = mid.replace(/[\s,]/g, '');
	if (/^m7(-5|b5)/.test(m)) return 'm7b5';
	if (/^dim7/.test(m)) return 'dim7';
	if (/^dim/.test(m) || m === '-5') return 'dim';
	if (/^(\+|aug)/.test(m)) return 'aug';
	if (/^(mM7|mmaj7)/.test(m)) return 'mmaj7';
	if (/^madd/.test(m)) return 'madd9';
	if (/^m(9|11|13)/.test(m)) return 'm9';
	if (/^m7/.test(m)) return 'm7';
	if (/^m6/.test(m)) return 'm6';
	if (/^m/.test(m)) return 'min';
	if (/^(M|maj)(9|11|13)/.test(m)) return 'maj9';
	if (/^(M|maj)7/.test(m)) return 'maj7';
	if (/^(M|maj)6/.test(m)) return '6';
	if (/^(M|maj)/.test(m)) return 'maj';
	if (/^7sus/.test(m)) return '7sus4';
	if (/^sus2/.test(m)) return 'sus2';
	if (/^sus/.test(m)) return 'sus4';
	if (/^add(9|2)/.test(m)) return 'add9';
	if (/^6/.test(m)) return '6';
	if (/^5$/.test(m)) return '5';
	if (/^(9|11|13)/.test(m)) return '9';
	if (/^7/.test(m)) return '7';
	return 'maj';
}

// Node kinds are detected by their fields because class names do not survive minification.
const isMeasure = (n: FumenNode) => 'raw_new_line' in n && 'align' in n;
const isChord = (n: FumenNode) => 'chord_str' in n;
const isRest = (n: FumenNode) => 'length_s' in n && !('chord_str' in n);
const isTime = (n: FumenNode) => 'numer' in n && 'denom' in n;
const isRehearsalGroup = (n: FumenNode) => 'inline' in n && 'name' in n;

function noteRows(n: FumenNode): number | null {
	const groups = n['note_group_list'];
	if (!Array.isArray(groups) || groups.length === 0) return null;
	let units = 0;
	for (const g of groups as { lengthIndicator?: { length?: number } }[]) {
		units += g.lengthIndicator?.length ?? 0;
	}
	return units / FUMEN_UNITS_PER_ROW;
}

function variable(track: FumenNode, name: string): string {
	const vars = track['variables'] as
		| Record<string, { value?: unknown } | undefined>
		| undefined;
	const direct = vars?.[name]?.value;
	if (typeof direct === 'string') return direct;
	for (const n of track.childNodes ?? []) {
		if (n['name'] === name && typeof n['value'] === 'string') {
			return n['value'];
		}
	}
	return '';
}

function parseKey(text: string): { key: number; scale: string } {
	const m = /^([A-Ga-g])([#b]?)\s*(m|min|minor)?$/.exec(text.trim());
	if (!m) return { key: 0, scale: 'Major' };
	return {
		key: pitchClass(m[1], m[2]) ?? 0,
		scale: m[3] ? 'Minor' : 'Major',
	};
}

function collectChords(track: FumenNode): {
	chords: ExportChord[];
	markers: ExportMarker[];
	meters: ExportMeter[];
	endRow: number;
} {
	const chords: ExportChord[] = [];
	const markers: ExportMarker[] = [];
	const meters: ExportMeter[] = [{ row: 0, num: 4, den: 4 }];
	let pendingMarker = '';
	let measureTime: [number, number] = [4, 4];
	let measureStart = 0;
	let last: ExportChord | null = null;

	const doMeasure = (measure: FumenNode) => {
		const items = measure.childNodes ?? [];
		for (const n of items) {
			if (!isTime(n)) continue;
			const nn = Number(n['numer']);
			const dd = Number(n['denom']);
			if (nn > 0 && [2, 4, 8, 16].includes(dd)) {
				const changed = nn !== measureTime[0] || dd !== measureTime[1];
				measureTime = [nn, dd];
				if (measureStart === 0) meters[0] = { row: 0, num: nn, den: dd };
				else if (changed) meters.push({ row: measureStart, num: nn, den: dd });
			}
		}
		const rows = (measureTime[0] * 16) / measureTime[1];
		const end = measureStart + rows;

		if (pendingMarker !== '') {
			markers.push({ start: measureStart, name: pendingMarker });
			pendingMarker = '';
		}
		// Elements without an explicit duration share what the others leave over.
		const timed = items.filter((n) => isChord(n) || isRest(n));
		const explicit = timed.reduce((s, n) => s + (noteRows(n) ?? 0), 0);
		const implicitCount = timed.filter((n) => noteRows(n) === null).length;
		const share =
			implicitCount === 0
				? 0
				: Math.max(rows - explicit, rows / timed.length) / implicitCount;

		let pos = measureStart;
		for (const n of timed) {
			const len = noteRows(n) ?? share;
			const to = Math.min(pos + len, end);
			const from = pos;
			pos += len;
			if (to <= from || isRest(n)) continue;
			if (n['isSyncopationShadowChord'] === true) continue;
			if (n['is_valid_chord'] === false) continue;

			const name = str(n['chord_name_str']);
			if (name === '') {
				if (last && last.start + last.length === from) last.length = to - last.start;
				continue;
			}

			const bass = pitchClass(n['base_note_base'], n['base_sharp_flat']);
			const root = n['note_base']
				? pitchClass(n['note_base'], n['sharp_flat'])
				: (last?.root ?? null);
			if (root === null) continue;

			const chord: ExportChord = {
				start: from,
				length: to - from,
				root,
				quality: n['note_base']
					? qualityId(str(n['mid_str']))
					: (last?.quality ?? 'maj'),
				bass,
			};
			chords.push(chord);
			last = chord;
		}
		measureStart = end;
	};

	const walk = (n: FumenNode) => {
		if (isMeasure(n)) {
			doMeasure(n);
			return;
		}
		if (isRehearsalGroup(n)) pendingMarker = str(n['name']).trim();
		n.childNodes?.forEach(walk);
	};
	walk(track);

	return { chords, markers, meters, endRow: measureStart };
}

function templateSong(): Record<string, unknown> {
	const mdx = {
		mdx_timer: 0,
		mdx_timer_b: 200,
		mdx_clocks_per_row: 12,
		mdx_play_rows: 0,
		mdx_play_clocks: 0,
		mdx_loop_start: 0,
		mdx_loop_end: 0,
		mdx_loop_jumps: 0,
		mdx_fade_clocks: 0,
		mdx_fade_mute_clocks: 0,
		mdx_fade_speed: 0,
		mdx_loop_expanded: 0,
	};
	const automation = (track: number) => ({
		track,
		target: 0,
		enabled: true,
		shape: 1,
		height: 58.0,
		follow: true,
		gain_range: 2.0,
		points: [],
		clips: [],
	});
	return {
		title: 'Untitled',
		author: '',
		target: 'studio',
		bpm: 120,
		lpb: 4,
		key: 0,
		scale: 'Major',
		it_timing: false,
		it_speed: 6,
		it_tempo: 125,
		rows: 64,
		tracks: 1,
		...mdx,
		mix_gain: 1.0,
		pcm_bus_gain: 1.0,
		track_kinds: [0],
		track_inst: [0],
		track_instrument_empty: [false],
		video: {
			fps: 24.0,
			offset: 0.0,
			streamer_seconds: 2.0,
			make_way: false,
			proximity: 60.0,
			delay: 0.3499999940395355,
			cooldown: 1.5,
			assets: [],
			clips: [],
			cues: [],
		},
		arr_automation: [automation(5), automation(10)],
		order: [0],
		studio_patterns: [],
		track_ids: [1],
		pattern_lanes: [false],
		master_track: 1024,
		next_studio_pattern_id: 1,
		next_track_id: 2,
		patterns: [{ rows: 64, cells: [], master: [], automation: [] }],
		instruments: [],
		track_mix: [
			{
				gain: 1.0,
				pan: 0.0,
				note_cols: 1,
				color: 0,
				background_blend: 0.0,
				icon: 1,
				mute: 0,
				solo: 0,
				audio_in_track: -1,
				audio_out_track: -1,
				audio_in_pre: false,
				audio_out_pre: false,
				arm: 0,
				in: 0,
				in_stereo: 1,
				monitor: 1,
				rec_source: 1,
				name: 'Track 1',
			},
		],
		track_dsp: [[]],
		track_instrument_dev: [
			{
				kind: 11,
				id: 1,
				on: 1,
				name: 'Instrument',
				params: new Array<number>(128).fill(0.0),
				mix_v: 1,
			},
		],
		meter_points: [{ row: 0, num: 4, den: 4 }],
	};
}

/** Builds the text of an .mdproject file from a track returned by the Fumen parser. */
export function buildMdProject(track: unknown, fallbackTitle: string): string {
	const t = track as FumenNode;
	const { chords, markers, meters, endRow } = collectChords(t);
	const { key, scale } = parseKey(variable(t, 'KEY'));
	const rowsPerBar = ((meters[0]?.num ?? 4) * 16) / (meters[0]?.den ?? 4);

	const song = templateSong();
	song['title'] = variable(t, 'TITLE') || fallbackTitle;
	song['author'] = variable(t, 'ARTIST');
	song['key'] = key;
	song['scale'] = scale;
	song['meter_points'] = meters;
	// endRow already ends on a bar of the last meter, so only the first-bar minimum is needed.
	song['rows'] = Math.max(endRow, rowsPerBar);
	if (markers.length > 0) {
		song['markers'] = markers.map((m, i) => ({
			start: m.start,
			length: (markers[i + 1]?.start ?? endRow) - m.start,
			name: m.name,
			color: sectionColor(m.name),
		}));
	}
	if (chords.length > 0) {
		song['chords'] = chords.map((c) => ({
			start: c.start,
			length: c.length,
			root: c.root,
			quality: c.quality,
			...(c.bass === null ? {} : { bass: c.bass }),
		}));
	}

	return JSON.stringify(
		{
			format: 'mdproject',
			version: 4,
			active_song: 0,
			songs: [song],
			saved_with: 'fumen-obsidian',
		},
		null,
		4,
	);
}
