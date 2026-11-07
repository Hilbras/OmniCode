export function firstCodePoint(text: string): number {
	return codePointAt(text, 0);
}

export function codePointAt(text: string, index: number): number {
	const point = text.codePointAt(index);
	return point === undefined ? 0 : point;
}
