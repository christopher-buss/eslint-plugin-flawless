declare const timeout: number | undefined;

export const options = {
	...(timeout !== undefined ? { timeout } : {}),
};
