declare const value: unknown;
declare const raw: Record<string, unknown>;
declare const key: string;

export const tag = Reflect.get(value, "tag");
export const name = Reflect.get(raw, "name");
export const dynamic = Reflect.get(raw, key);
export const computed = Reflect["get"](raw, "name");
